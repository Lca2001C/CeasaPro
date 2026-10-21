import { prisma } from "@/lib/db/prisma";
import { verifyPassword, hashDeIsca } from "@/lib/auth/password";
import { signAccess } from "@/lib/auth/jwt";
import { buildAccessPayload } from "@/lib/auth/build-session";
import { setAuthCookies } from "@/lib/auth/cookies";
import { createRefreshSession } from "@/lib/auth/refresh";
import { loginSchema } from "@/lib/validations/auth";
import {
  devolverUnidadeDb,
  rateLimitDb,
  resetRateLimit,
  respostaDeLimite,
} from "@/lib/security/rate-limit-db";
import { chaveDeLoginPorEmail } from "@/lib/auth/limite-login";
import { audit } from "@/lib/audit";
import { clientIp, userAgent } from "@/lib/http/request";
import { errorResponse } from "@/lib/http/error-response";
import { recusaDeOutraOrigem } from "@/lib/http/mesma-origem";

export const runtime = "nodejs";

/**
 * Falha inesperada (banco fora, rate limit sem conexão) sai no envelope padrão
 * de `errorResponse`: 500 com `{ ok: false, error: { code: "INTERNAL" } }` e a
 * referência do log, nunca um 500 cru que o formulário não sabe ler. A mensagem
 * não diz nada sobre a conta — o genérico de credencial continua valendo.
 */
export async function POST(req: Request) {
  // Escrita de outro site (login/logout CSRF) — ver `mesma-origem.ts`.
  const recusa = recusaDeOutraOrigem(req, true);
  if (recusa) return recusa;
  try {
    return await entrar(req);
  } catch (e) {
    return errorResponse(e);
  }
}

async function entrar(req: Request): Promise<Response> {
  const ip = (await clientIp()) ?? "unknown";
  const body = await req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION", message: "Dados inválidos" } },
      { status: 422 },
    );
  }
  const { email, password } = parsed.data;

  // Dois limites, de propósito. O de IP+e-mail é o que contém a força bruta
  // comum. O de e-mail sozinho é a rede de segurança: se a identificação de
  // origem falhar (proxy mal configurado, cadeia de headers inesperada), a conta
  // alvo continua protegida contra tentativa distribuída. O limite por e-mail é
  // folgado para que trancar a conta de alguém de fora exija esforço sustentado.
  //
  // O terceiro, só por IP, fecha o "password spraying": uma senha comum
  // testada contra milhares de e-mails, um por vez, nunca estourava os outros
  // dois — e cada tentativa custa um Argon2 de ~19 MB. Ele conta só a tentativa
  // que FALHOU: o CEASA tem dezenas de boxes atrás do mesmo Wi-Fi (e a
  // operadora móvel põe muitos clientes num IP só), e contar o acerto barrava o
  // 61º dono que entrava com a senha certa. O acerto também não zera a janela —
  // quem espalha tentativas pode ter UMA conta válida. Com IP desconhecido fica
  // de fora: todo mundo cairia no mesmo balde.
  const rateKeyIp = `login:${ip}:${email}`;
  const rateKeyEmail = chaveDeLoginPorEmail(email);
  const rateKeySoIp = ip === "unknown" ? null : `login:ip:${ip}`;
  const janela = 15 * 60 * 1000;
  const limiteSoIp = { limit: 60, windowMs: janela };
  // O balde só por IP é CONSUMIDO aqui, atomicamente, e devolvido no acerto
  // (`devolverUnidadeDb`). Consultar antes e registrar a falha depois deixava
  // as tentativas em paralelo passarem todas: cada uma lia o contador antes de
  // qualquer outra registrar.
  const [rlIp, rlSoIp] = await Promise.all([
    rateLimitDb(rateKeyIp, { limit: 5, windowMs: janela }),
    rateKeySoIp ? rateLimitDb(rateKeySoIp, limiteSoIp) : Promise.resolve(null),
  ]);
  // O contador do e-mail só recebe a tentativa que passou nos de IP. Contando
  // tudo, UM IP com 21 tentativas a cada 15 min trancava a conta de qualquer
  // pessoa, indefinidamente (a recusa vem antes da senha, então nem o acerto
  // do dono destravava). Assim cada IP põe no máximo 5 tentativas por janela
  // nele, e trancar alguém de fora exige, de fato, várias origens.
  const barradoPorIp = [rlIp, rlSoIp].find((r) => r && !r.ok);
  const rlEmail = barradoPorIp
    ? null
    : await rateLimitDb(rateKeyEmail, { limit: 20, windowMs: janela });
  const estourou = barradoPorIp ?? (rlEmail && !rlEmail.ok ? rlEmail : undefined);
  if (estourou) return respostaDeLimite(estourou);

  const user = await prisma.user.findFirst({
    where: { email, active: true, deletedAt: null },
    // O Argon2 precisa do hash; é a única leitura dele no login.
    omit: { passwordHash: false },
  });

  // Mensagem genérica — nunca revelar se o e-mail existe.
  const invalid = () =>
    Response.json(
      { ok: false, error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha incorretos." } },
      { status: 401 },
    );

  // Verifica SEMPRE um hash, mesmo sem usuário: é o tempo de resposta, e não a
  // mensagem, que revelaria se o e-mail existe. Contra a isca nenhuma senha bate.
  const okPass = await verifyPassword(user?.passwordHash ?? (await hashDeIsca()), password);
  // Falha: a unidade consumida no balde só por IP fica (é ela que conta).
  if (!user || !okPass) return invalid();

  const payload = await buildAccessPayload(user.id);
  if (!payload) return invalid();

  // Acerto não conta no balde só por IP — senão o 61º box atrás do mesmo Wi-Fi
  // do CEASA era barrado com a senha certa.
  if (rateKeySoIp) await devolverUnidadeDb(rateKeySoIp);

  // Credencial correta: a janela é liberada. O limite existe para conter
  // adivinhação de senha, então só tentativa que falha deve consumi-lo — senão
  // a mesma pessoa entrando de dois aparelhos trancaria a própria conta.
  await Promise.all([resetRateLimit(rateKeyIp), resetRateLimit(rateKeyEmail)]);

  const sessao = await createRefreshSession(user.id, {
    ip,
    userAgent: (await userAgent()) ?? undefined,
  });
  const accessToken = await signAccess({ ...payload, fid: sessao.familyId });
  await setAuthCookies(accessToken, sessao.raw);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    actorEmail: user.email,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    ip,
  });

  const redirectTo = user.role === "SUPER_ADMIN" ? "/admin" : "/dashboard";
  return Response.json({ ok: true, data: { redirectTo, mustChangePassword: user.mustChangePassword } });
}
