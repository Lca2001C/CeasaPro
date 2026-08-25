import { after } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { resetSchema } from "@/lib/validations/auth";
import { audit } from "@/lib/audit";
import { rateLimitDb } from "@/lib/security/rate-limit-db";
import { clientIp } from "@/lib/http/request";
import { logger } from "@/lib/logger";
import { absoluteUrl } from "@/lib/app-url";
import { sendEmail, passwordChangedEmail } from "@/lib/email";
import { consumeResetToken, findUserByResetToken } from "@/lib/auth/password-reset";

export const runtime = "nodejs";

/** Resposta única para token ausente, expirado ou já usado (não distingue os casos). */
function invalidToken() {
  return Response.json(
    {
      ok: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Link inválido ou expirado. Peça um novo link de redefinição.",
      },
    },
    { status: 400 },
  );
}

/**
 * POST /api/auth/reset — grava a nova senha a partir do token do e-mail.
 *
 * O token é de uso único: `consumeResetToken` só grava se o hash ainda estiver
 * na linha, então um segundo POST com o mesmo link recebe INVALID_TOKEN.
 * Trocar a senha derruba todas as sessões (refresh tokens revogados).
 */
export async function POST(req: Request) {
  const ip = (await clientIp()) ?? "unknown";
  const rl = await rateLimitDb(`reset:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  if (!rl.ok) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMIT",
          message: "Muitas tentativas. Tente novamente em alguns minutos.",
        },
      },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: parsed.error.issues[0]?.message ?? "Dados inválidos",
        },
      },
      { status: 422 },
    );
  }

  const user = await findUserByResetToken(parsed.data.token);
  if (!user) return invalidToken();

  const passwordHash = await hashPassword(parsed.data.password);
  const applied = await consumeResetToken({
    userId: user.id,
    rawToken: parsed.data.token,
    passwordHash,
  });
  // Perdeu a corrida (o link já tinha sido usado ou expirou entre a checagem e a gravação).
  if (!applied) return invalidToken();

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    actorEmail: user.email,
    action: "PASSWORD_RESET",
    entity: "User",
    entityId: user.id,
    newData: { passwordReset: true, sessionsRevoked: true },
    ip,
  });

  // Aviso de segurança — não pode atrasar a resposta nem falhar a troca.
  after(async () => {
    const { subject, html } = passwordChangedEmail({ loginUrl: absoluteUrl("/login") });
    const sent = await sendEmail(user.email, subject, html, {
      tags: [{ name: "tipo", value: "senha-alterada" }],
    });
    if (!sent.ok) {
      logger.error({ err: sent.error, userId: user.id }, "Falha ao enviar aviso de senha alterada");
    }
  });

  return Response.json({ ok: true, data: null });
}
