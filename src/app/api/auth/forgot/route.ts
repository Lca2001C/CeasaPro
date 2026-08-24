import { after } from "next/server";
import { forgotSchema } from "@/lib/validations/auth";
import { sendEmail, passwordResetEmail } from "@/lib/email";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/http/request";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { absoluteUrl, hasConfiguredAppUrl } from "@/lib/app-url";
import { findResettableUserByEmail, issueResetToken } from "@/lib/auth/password-reset";
import { RESET_TOKEN_TTL_MINUTES } from "@/lib/auth/reset-token";

export const runtime = "nodejs";

/**
 * POST /api/auth/forgot — pede o link de redefinição de senha.
 *
 * A resposta é SEMPRE a mesma (200, mensagem genérica), inclusive quando o
 * e-mail não existe, a conta está inativa ou o rate limit estourou: qualquer
 * diferença viria a ser um oráculo de enumeração de contas.
 *
 * Por isso o trabalho real (consultar, gerar token, enviar e-mail) roda em
 * `after()`, depois da resposta: além de não bloquear o usuário, o tempo de
 * resposta fica igual para e-mail existente e inexistente (sem o envio via
 * Resend no meio, que é uma chamada de rede de centenas de ms).
 */
export async function POST(req: Request) {
  const ip = (await clientIp()) ?? "unknown";
  const body = await req.json().catch(() => ({}));
  const parsed = forgotSchema.safeParse(body);

  const generic = Response.json({
    ok: true,
    data: { message: "Se o e-mail existir, enviaremos as instruções." },
  });

  if (!parsed.success) return generic;
  const email = parsed.data.email; // já normalizado (trim + lowercase) pelo schema

  // Dois limites: por IP (impede varredura) e por e-mail (impede usar o
  // formulário para inundar a caixa de uma pessoa específica, de vários IPs).
  const byIp = rateLimit(`forgot:ip:${ip}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  const byEmail = rateLimit(`forgot:email:${email}`, { limit: 3, windowMs: 15 * 60 * 1000 });
  if (!byIp.ok || !byEmail.ok) {
    logger.warn({ ip, scope: byIp.ok ? "email" : "ip" }, "Rate limit em /api/auth/forgot");
    return generic;
  }

  after(async () => {
    try {
      const user = await findResettableUserByEmail(email);
      if (!user) {
        logger.debug({ ip }, "Pedido de redefinição para e-mail sem conta ativa");
        return;
      }

      const { raw } = await issueResetToken(user.id);
      const link = absoluteUrl(`/recuperar-senha/${raw}`);

      // Sem RESEND_API_KEY (dev), sendEmail é no-op — o link vai para o log
      // para dar como testar o fluxo inteiro sem caixa de e-mail.
      if (!process.env.RESEND_API_KEY) {
        logger.info({ link }, "[DEV] Link de redefinição de senha");
      }
      if (process.env.NODE_ENV === "production" && !hasConfiguredAppUrl()) {
        logger.error(
          "APP_URL/NEXT_PUBLIC_APP_URL ausentes e RENDER_EXTERNAL_URL indisponível — " +
            "o link de redefinição está apontando para localhost.",
        );
      }

      const { subject, html } = passwordResetEmail(link, RESET_TOKEN_TTL_MINUTES);
      const sent = await sendEmail(user.email, subject, html, {
        tags: [{ name: "tipo", value: "redefinir-senha" }],
      });
      if (!sent.ok) {
        // O usuário já recebeu a resposta genérica; sem este log a falha ficaria invisível.
        logger.error({ err: sent.error, userId: user.id }, "Falha ao enviar e-mail de redefinição");
      }

      await audit({
        tenantId: user.tenantId,
        userId: user.id,
        actorEmail: user.email,
        action: "PASSWORD_RESET_REQUESTED",
        entity: "User",
        entityId: user.id,
        newData: { emailSent: sent.ok },
        ip,
      });
    } catch (e) {
      logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "Erro no fluxo de redefinição de senha",
      );
    }
  });

  return generic;
}
