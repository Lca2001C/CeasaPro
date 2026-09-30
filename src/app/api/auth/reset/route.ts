import { after } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { resetSchema } from "@/lib/validations/auth";
import { errorResponse } from "@/lib/http/error-response";
import { rateLimitDb, respostaDeLimite } from "@/lib/security/rate-limit-db";
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
 *
 * Falha inesperada (banco fora, Argon2 sem memória) sai no envelope padrão de
 * `errorResponse` — o formulário mostra a mensagem com a referência do log, em
 * vez de um 500 cru que ele não sabe ler.
 */
export async function POST(req: Request) {
  try {
    return await redefinir(req);
  } catch (e) {
    return errorResponse(e);
  }
}

async function redefinir(req: Request): Promise<Response> {
  const ip = (await clientIp()) ?? "unknown";
  const rl = await rateLimitDb(`reset:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  if (!rl.ok) {
    return respostaDeLimite(rl);
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
    // A auditoria `PASSWORD_RESET` é gravada lá dentro, na mesma transação da
    // senha e da revogação.
    ip,
  });
  // Perdeu a corrida (o link já tinha sido usado ou expirou entre a checagem e a gravação).
  if (!applied) return invalidToken();

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
