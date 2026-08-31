import { after } from "next/server";
import { signupSchema } from "@/lib/validations/auth";
import { rateLimitDb } from "@/lib/security/rate-limit-db";
import { clientIp } from "@/lib/http/request";
import { logger } from "@/lib/logger";
import { hasConfiguredAppUrl } from "@/lib/app-url";
import { SignupService } from "@/lib/services/signup.service";
import { errorResponse } from "@/lib/http/error-response";

export const runtime = "nodejs";

/**
 * POST /api/auth/signup — cadastro público com 7 dias de teste.
 *
 * A resposta de SUCESSO é sempre a mesma, inclusive quando o e-mail já tem conta:
 * qualquer diferença viria a ser um oráculo de "esta pessoa é cliente do
 * CeasaPro?" — o mesmo canal que o login e o `/api/auth/forgot` já fecham. Quem é
 * dono do endereço recebe a explicação por e-mail (ver `SignupService.register`).
 *
 * Por isso o trabalho real (Argon2, criação da empresa, envio do e-mail) roda em
 * `after()`, depois da resposta: além de não fazer a pessoa esperar, o tempo de
 * resposta fica igual para e-mail novo e e-mail já cadastrado.
 *
 * Erro de VALIDAÇÃO, sim, é reportado (422 pelo schema): o campo mal preenchido é
 * do próprio usuário e não diz nada sobre a base.
 */
export async function POST(req: Request) {
  const ip = (await clientIp()) ?? "unknown";
  const body = await req.json().catch(() => ({}));
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error);
  }
  const input = parsed.data;

  const generic = Response.json({
    ok: true,
    data: {
      message:
        "Enviamos um link de confirmação para o seu e-mail. Confirme para começar os 7 dias de teste.",
    },
  });

  // Dois limites: por IP (impede criação em massa de contas de teste) e por
  // e-mail (impede usar o formulário para inundar a caixa de uma pessoa).
  const byIp = await rateLimitDb(`signup:ip:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  const byEmail = await rateLimitDb(`signup:email:${input.email}`, {
    limit: 3,
    windowMs: 60 * 60 * 1000,
  });
  if (!byIp.ok || !byEmail.ok) {
    logger.warn({ ip, scope: byIp.ok ? "email" : "ip" }, "Rate limit em /api/auth/signup");
    // Também genérico: dizer "muitas tentativas" já confirmaria que houve
    // tentativa anterior naquele e-mail.
    return generic;
  }

  after(async () => {
    try {
      const res = await SignupService.register(input, { ip });

      // Fora de produção o link SEMPRE vai para o log (`devToken` só existe fora
      // de produção). Antes isto era condicionado a "SMTP não configurado", e a
      // consequência era pior justamente quando mais doía: com SMTP configurado
      // mas com credencial recusada, o e-mail não saía E o link não aparecia —
      // ninguém conseguia concluir um cadastro em desenvolvimento.
      if (res.devToken) {
        logger.info(
          { link: `/cadastro/confirmar/${res.devToken}` },
          "[DEV] Link de confirmação de cadastro",
        );
      }
      if (process.env.NODE_ENV === "production" && !hasConfiguredAppUrl()) {
        logger.error(
          "APP_URL/NEXT_PUBLIC_APP_URL ausentes — o link de confirmação está apontando para localhost.",
        );
      }
    } catch (e) {
      // A pessoa já recebeu 200. Sem este log, um cadastro que falhou no meio
      // (sem plano ativo, banco fora) desapareceria sem rastro.
      logger.error(
        { err: e instanceof Error ? e.message : String(e), ip },
        "Falha ao processar cadastro público",
      );
    }
  });

  return generic;
}
