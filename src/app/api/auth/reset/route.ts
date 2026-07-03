import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllForUser } from "@/lib/auth/refresh";
import { resetSchema } from "@/lib/validations/auth";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/http/request";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION", message: "Dados inválidos" } },
      { status: 422 },
    );
  }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const user = await prisma.user.findFirst({
    where: {
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: { gt: new Date() },
      active: true,
      deletedAt: null,
    },
  });
  if (!user) {
    return Response.json(
      { ok: false, error: { code: "INVALID_TOKEN", message: "Link inválido ou expirado." } },
      { status: 400 },
    );
  }
  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      mustChangePassword: false,
    },
  });
  await revokeAllForUser(user.id);
  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    actorEmail: user.email,
    action: "STATUS_CHANGE",
    entity: "User",
    entityId: user.id,
    newData: { passwordReset: true },
    ip: await clientIp(),
  });
  return Response.json({ ok: true, data: null });
}
