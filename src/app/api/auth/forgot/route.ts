import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { forgotSchema } from "@/lib/validations/auth";
import { sendEmail, passwordResetEmail } from "@/lib/email";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/http/request";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = (await clientIp()) ?? "unknown";
  const body = await req.json().catch(() => ({}));
  const parsed = forgotSchema.safeParse(body);
  // Resposta sempre genérica (não revela se o e-mail existe).
  const generic = Response.json({
    ok: true,
    data: { message: "Se o e-mail existir, enviaremos as instruções." },
  });
  if (!parsed.success) return generic;

  const rl = rateLimit(`forgot:${ip}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  if (!rl.ok) return generic;

  const user = await prisma.user.findFirst({
    where: { email: parsed.data.email, active: true, deletedAt: null },
  });
  if (user) {
    const raw = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const link = `${process.env.APP_URL ?? "http://localhost:3000"}/recuperar-senha/${raw}`;
    // Em dev, sem RESEND_API_KEY o e-mail não é enviado (no-op). Logamos o link
    // para permitir testar o fluxo de redefinição localmente sem caixa de e-mail.
    if (!process.env.RESEND_API_KEY) {
      logger.info({ link }, "[DEV] Link de redefinição de senha");
    }
    const { subject, html } = passwordResetEmail(link);
    await sendEmail(user.email, subject, html);
  }
  return generic;
}
