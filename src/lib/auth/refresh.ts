import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";

const refreshDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "30");

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Por que uma sessão foi revogada.
 *
 * Sem isto, `revokedAt != null` significava quatro coisas ao mesmo tempo, e
 * qualquer detecção de reuso transformaria um logout normal em "ataque
 * detectado". A distinção é o que torna a detecção possível.
 */
export type MotivoRevogacao =
  | "ROTATED"
  | "LOGOUT"
  | "ADMIN"
  | "PASSWORD"
  | "TENANT"
  | "REUSE";

/**
 * Janela de graça para o token recém-rotacionado continuar sendo aceito.
 *
 * Três produtores renovam concorrentemente e nenhum enxerga o outro:
 * `api-client` tem voo único POR ABA, `SessaoViva` usa uma trava de
 * `localStorage` que é cooperativa (e some em aba anônima), e o desvio do proxy
 * para `/api/auth/renovar` não conhece nenhum dos dois. Some-se o caso que
 * trava nenhuma cobre: a resposta se perde DEPOIS de o servidor já ter
 * rotacionado, e o cliente reenvia com o cookie antigo.
 *
 * Sem a janela, todos esses casos legítimos seriam indistinguíveis de reuso
 * malicioso — e um desenho que desloga usuário legítimo é pior que o bug.
 */
const GRACA_MS = 30_000;
const GRACA_MAX_USOS = 3;

/** Cria um refresh token opaco, guarda apenas o hash, e devolve o token cru. */
export async function createRefreshToken(
  userId: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<string> {
  const raw = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt,
      // Aparelho novo, linhagem nova.
      familyId: randomBytes(16).toString("base64url"),
      userAgent: meta?.userAgent,
      ip: meta?.ip,
    },
  });
  return raw;
}

/** O que aconteceu ao apresentar um refresh token. */
export type ResultadoRotacao =
  | { tipo: "ok"; userId: string; newToken: string }
  /** Corrida legítima: token recém-rotacionado, dentro da janela de graça. */
  | { tipo: "corrida"; userId: string; newToken: string }
  /** Token roubado reapresentado — a família inteira foi revogada. */
  | { tipo: "reuso"; userId: string; familyId: string }
  /** Inexistente, expirado, ou revogado por logout/admin/senha. */
  | { tipo: "invalido" };

/**
 * Valida o token atual, revoga-o e emite um novo — detectando reuso.
 *
 * A árvore de decisão:
 *
 *   não existe / expirado          → invalido   (nenhuma escrita, nenhum alarme)
 *   vivo                           → ok
 *   revogado, motivo != ROTATED    → invalido   (logout/admin/senha NÃO é ataque)
 *   revogado por ROTATED, recente  → corrida    (emite outro na mesma família)
 *   revogado por ROTATED, antigo   → REUSO      (revoga a família inteira)
 *
 * Quatro detalhes que fazem isto não derrubar gente legítima e não abrir brecha:
 *
 * 1. `revokedAt` NUNCA é reescrito no caminho de corrida. Se fosse, um atacante
 *    manteria a janela escorregando para sempre.
 * 2. `graceUses` limita a três: cobre duas abas mais o reenvio de uma resposta
 *    perdida, e ainda assim é finito.
 * 3. Token DESCONHECIDO não revoga nada. Isso fecha o DoS de terceiro: quem não
 *    tem um refresh token real não consegue derrubar a sessão de ninguém. Só o
 *    portador de um token verdadeiro dispara o alarme — e aí derrubar a sessão
 *    é exatamente a resposta certa.
 * 4. Quem chama responde a `reuso` EXATAMENTE como responde a `invalido`. O
 *    atacante não recebe sinal de que foi detectado.
 */
export async function rotateRefreshToken(
  raw: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<ResultadoRotacao> {
  const tokenHash = hashToken(raw);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing || existing.expiresAt < new Date()) return { tipo: "invalido" };

  if (existing.revokedAt) {
    // Revogado por logout, ação do admin ou troca de senha: é o fim normal de
    // uma sessão, não um ataque.
    if (existing.revokedReason !== "ROTATED") return { tipo: "invalido" };

    const idade = Date.now() - existing.revokedAt.getTime();
    if (idade <= GRACA_MS && existing.graceUses < GRACA_MAX_USOS) {
      const novo = await emitirNaFamilia(existing.userId, existing.familyId, meta);
      await prisma.refreshToken.update({
        where: { id: existing.id },
        // `revokedAt` fica como está — de propósito. Ver o detalhe 1 acima.
        data: { graceUses: { increment: 1 } },
      });
      return { tipo: "corrida", userId: existing.userId, newToken: novo };
    }

    await revogarFamilia(existing.familyId);
    return { tipo: "reuso", userId: existing.userId, familyId: existing.familyId };
  }

  const newRaw = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
  const [, criado] = await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokedReason: "ROTATED" },
    }),
    prisma.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hashToken(newRaw),
        expiresAt,
        familyId: existing.familyId,
        userAgent: meta?.userAgent,
        ip: meta?.ip,
      },
    }),
  ]);
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { replacedById: criado.id },
  });
  return { tipo: "ok", userId: existing.userId, newToken: newRaw };
}

async function emitirNaFamilia(
  userId: string,
  familyId: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<string> {
  const raw = randomBytes(48).toString("base64url");
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000),
      familyId,
      userAgent: meta?.userAgent,
      ip: meta?.ip,
    },
  });
  return raw;
}

/**
 * Revoga a linhagem inteira de um aparelho.
 *
 * A família, e não a conta: revogar tudo do usuário derrubaria o celular dele
 * porque o notebook foi comprometido. A família é a menor unidade que
 * certamente contém o token vazado. Escalar para a conta inteira é decisão
 * humana, e a auditoria dá o material para tomá-la.
 */
async function revogarFamilia(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "REUSE" },
  });
}

/**
 * Registra o reuso na trilha de auditoria.
 *
 * Guardar os DOIS endereços — o de quem apresentou o token queimado e o de quem
 * o obteve originalmente — é o que permite investigar depois. Sem isso, a
 * detecção derruba a sessão e não deixa nada para o dono entender o que houve.
 *
 * Fica aqui, e não nas duas rotas que chamam a rotação, para as duas não
 * divergirem no que registram.
 */
export async function auditarReusoDeSessao(
  userId: string,
  familyId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  try {
    const [user, original] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, tenantId: true },
      }),
      prisma.refreshToken.findFirst({
        where: { familyId },
        orderBy: { createdAt: "asc" },
        select: { ip: true, userAgent: true, createdAt: true },
      }),
    ]);
    logger.error(
      { userId, familyId, ipApresentacao: meta?.ip ?? null, ipOriginal: original?.ip ?? null },
      "Reuso de refresh token detectado — família revogada",
    );
    await audit({
      tenantId: user?.tenantId ?? null,
      userId,
      actorEmail: user?.email ?? null,
      action: "SESSION_REUSE_DETECTED",
      entity: "RefreshToken",
      entityId: familyId,
      newData: {
        ipApresentacao: meta?.ip ?? null,
        userAgentApresentacao: meta?.userAgent ?? null,
        ipDaSessaoOriginal: original?.ip ?? null,
        userAgentDaSessaoOriginal: original?.userAgent ?? null,
        sessaoAbertaEm: original?.createdAt?.toISOString() ?? null,
      },
      ip: meta?.ip ?? null,
    });
  } catch (e) {
    // A auditoria não pode impedir a revogação, que é a parte que protege.
    logger.error(
      { err: e instanceof Error ? e.message : String(e) },
      "Falha ao auditar reuso de refresh token",
    );
  }
}

export async function revokeRefreshToken(
  raw: string,
  motivo: MotivoRevogacao = "LOGOUT",
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(raw), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: motivo },
  });
}

/**
 * Revoga todas as sessões de um usuário — inclusive os ACCESS TOKENS.
 *
 * O incremento de `sessionEpoch` mora AQUI, e não em cada chamador, e isso é o
 * ponto: os oito lugares que precisavam disso (desativar usuário, resetar
 * senha, excluir usuário, excluir/bloquear empresa, chargeback, troca de senha,
 * redefinição) já chamavam esta função ou a irmã dela. Espalhar o incremento
 * garantiria que um deles ficasse de fora.
 *
 * `LOGOUT` NÃO passa por aqui de propósito: sair de um aparelho não é sair de
 * todos, e o logout já apaga os cookies — um cookie apagado não é enviado.
 */
export async function revokeAllForUser(
  userId: string,
  motivo: MotivoRevogacao = "ADMIN",
): Promise<void> {
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: motivo },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { sessionEpoch: { increment: 1 } },
    }),
  ]);
}

/** Revoga todas as sessões de uma empresa (bloqueio imediato pelo super-admin). */
export async function revokeAllForTenant(
  tenantId: string,
  motivo: MotivoRevogacao = "TENANT",
): Promise<void> {
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { user: { tenantId }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: motivo },
    }),
    prisma.tenant.update({
      where: { id: tenantId },
      data: { sessionEpoch: { increment: 1 } },
    }),
  ]);
}

/**
 * Quanto tempo um token revogado ainda é guardado.
 *
 * Não se apaga na hora porque a linha revogada é a evidência de reuso: se um
 * token já rotacionado reaparecer, é sinal de cópia roubada. Sete dias é prazo
 * suficiente para essa detecção sem acumular a tabela para sempre — e agora a
 * detecção existe de fato (`rotateRefreshToken`), então este prazo É a janela
 * em que um roubo ainda é percebido.
 */
const DIAS_DE_RETENCAO = 7;

/**
 * Remove sessões que não servem mais para nada: vencidas, ou revogadas há mais
 * de uma semana.
 *
 * Existe porque nada limpava esta tabela. Cada login e cada renovação criam uma
 * linha — e a renovação passou a acontecer enquanto o app está aberto (ver
 * `SessaoViva`), então o crescimento deixou de ser desprezível. Roda no cron
 * diário, junto das outras manutenções.
 */
export async function purgeDeadRefreshTokens(now: Date = new Date()): Promise<number> {
  const limiteRevogados = new Date(now.getTime() - DIAS_DE_RETENCAO * 24 * 60 * 60 * 1000);
  const { count } = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { revokedAt: { lt: limiteRevogados } },
      ],
    },
  });
  return count;
}
