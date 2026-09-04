import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { signAccess } from "@/lib/auth/jwt";
import { buildAccessPayload } from "@/lib/auth/build-session";
import { setAuthCookies } from "@/lib/auth/cookies";
import { createRefreshToken, revokeAllForUser } from "@/lib/auth/refresh";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { trialEndFrom } from "@/lib/billing/status";
import { ADMIN_PLAN_SLUG } from "@/lib/services/plano.service";
import {
  provisionTenant,
  liberarEmailDeContaExcluida,
} from "@/lib/services/tenant-provisioning";
import { AdminNotificationsService } from "@/lib/services/admin-notifications.service";
import type { GoogleProfile } from "@/lib/auth/google-oauth";

export type GoogleLoginResult =
  | { ok: true; userId: string; role: "OWNER" | "SUPER_ADMIN"; criado: boolean }
  | { ok: false; code: "google-falhou" | "google-inativo" };

/**
 * Resolve a conta depois que o Google já confirmou a identidade.
 *
 * Não abre sessão: quem chama (`/api/auth/google/callback`) grava os cookies.
 * Assim o serviço é testável sem o runtime de `cookies()` do Next.
 *
 * 1. Já tem `googleSub` — é a mesma conta.
 * 2. Já tem o e-mail — entra e grava o `googleSub`. Se o cadastro público ainda
 *    estava pendente, este login vale como a confirmação: confirma o e-mail,
 *    libera o teste grátis e **descarta a credencial anterior**, que veio de
 *    origem não comprovada.
 * 3. E-mail novo — cria a empresa e libera o trial: o Google já verificou o
 *    endereço, então o link de confirmação seria teatro.
 */
export async function resolverLoginGoogle(
  perfil: GoogleProfile,
  ctx: { ip: string | null },
): Promise<GoogleLoginResult> {
  const porGoogle = await prisma.user.findFirst({
    where: { googleSub: perfil.sub, deletedAt: null },
  });
  if (porGoogle) {
    if (!porGoogle.active) return { ok: false, code: "google-inativo" };
    return { ok: true, userId: porGoogle.id, role: porGoogle.role, criado: false };
  }

  // Ninguém ativo usa este `googleSub`, mas uma conta EXCLUÍDA pode continuar
  // ocupando o valor: `googleSub` é @unique e a exclusão só passou a liberá-lo
  // agora (admin.service.ts), então a base tem linhas antigas presas. Com o
  // vínculo preso, gravar o `googleSub` mais abaixo estourava violação de índice
  // dentro da transação e o callback — que não tem try/catch — devolvia 500: o
  // cliente que voltava nunca mais entrava pelo Google. Quem está na frente do
  // Google agora é o dono comprovado da identidade; a conta excluída a solta.
  await prisma.user.updateMany({
    where: { googleSub: perfil.sub, deletedAt: { not: null } },
    data: { googleSub: null },
  });

  const porEmail = await prisma.user.findFirst({
    where: { email: perfil.email, deletedAt: null },
  });
  if (porEmail) {
    if (!porEmail.active) return { ok: false, code: "google-inativo" };
    if (porEmail.googleSub && porEmail.googleSub !== perfil.sub) {
      return { ok: false, code: "google-falhou" };
    }
    // Linha de cadastro público que nunca confirmou o e-mail: até este instante
    // NINGUÉM provou ser dono do endereço. Qualquer pessoa pode ter se cadastrado
    // com o e-mail de um comerciante e escolhido a senha, e o `/api/auth/login`
    // não exige e-mail confirmado. Se a credencial local sobrevivesse ao vínculo,
    // quem plantou a conta continuaria entrando por e-mail+senha na empresa da
    // vítima — que só passa a ser usada de verdade porque este login liberou o
    // acesso. O Google acabou de provar quem é o dono; a senha de origem não
    // comprovada é descartada (a pessoa entra pelo Google ou usa /recuperar-senha).
    const pendente = !porEmail.emailVerifiedAt;
    await prisma.user.update({
      where: { id: porEmail.id },
      data: pendente
        ? {
            googleSub: perfil.sub,
            emailVerifiedAt: new Date(),
            passwordHash: await hashPassword(randomBytes(32).toString("hex")),
            // Tokens em aberto também são do impostor: o de confirmação nasceu do
            // cadastro dele e o de recuperação ele pode ter pedido antes.
            verifyTokenHash: null,
            verifyTokenExpiresAt: null,
            resetTokenHash: null,
            resetTokenExpiresAt: null,
          }
        : { googleSub: perfil.sub },
    });
    if (pendente) {
      // Sessão que ele já tenha aberto (refresh de 30 dias) cai junto.
      await revokeAllForUser(porEmail.id);
      // O teste grátis é do cadastro público, e é este login que faz o papel do
      // clique no e-mail de confirmação. Empresa cadastrada pelo admin nasce
      // SUSPENSA de propósito (admin.service.ts:134) e não passa por aqui.
      await concederTrialSePendente(porEmail.id);
    }
    return { ok: true, userId: porEmail.id, role: porEmail.role, criado: false };
  }

  const criado = await criarEmpresaPeloGoogle(perfil, ctx.ip);
  if (!criado) return { ok: false, code: "google-falhou" };
  return { ok: true, userId: criado.userId, role: "OWNER", criado: true };
}

/** Grava cookies de sessão — o mesmo pipeline do login por senha. */
export async function abrirSessaoGoogle(
  userId: string,
  role: "OWNER" | "SUPER_ADMIN",
  ctx: { ip: string | null; userAgent?: string },
): Promise<{ redirectTo: string } | null> {
  const payload = await buildAccessPayload(userId);
  if (!payload) return null;

  const accessToken = await signAccess(payload);
  const refreshToken = await createRefreshToken(userId, {
    ip: ctx.ip ?? undefined,
    userAgent: ctx.userAgent,
  });
  await setAuthCookies(accessToken, refreshToken);

  const user = await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
    select: { tenantId: true, email: true },
  });
  await audit({
    tenantId: user.tenantId,
    userId,
    actorEmail: user.email,
    action: "LOGIN",
    entity: "User",
    entityId: userId,
    newData: { origem: "google" },
    ip: ctx.ip,
  });

  return { redirectTo: role === "SUPER_ADMIN" ? "/admin" : "/dashboard" };
}

async function criarEmpresaPeloGoogle(
  perfil: GoogleProfile,
  ip: string | null,
): Promise<{ tenantId: string; userId: string } | null> {
  await liberarEmailDeContaExcluida(perfil.email);

  const plan = await prisma.plan.findFirst({
    where: { active: true, slug: { not: ADMIN_PLAN_SLUG } },
    orderBy: { priceMonthly: "asc" },
  });
  if (!plan) {
    logger.error("Login Google: nenhum plano ativo para o cadastro público");
    return null;
  }

  const now = new Date();
  const trialEndsAt = trialEndFrom(now);
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const tradeName = perfil.name.slice(0, 120);

  const criado = await prisma.$transaction(async (tx) => {
    const { tenantId, userId } = await provisionTenant(tx, {
      tradeName,
      phone: null,
      planId: plan.id,
      monthlyAmount: plan.priceMonthly,
      graceDays: 5,
      currentPeriodEnd: now,
      owner: {
        name: perfil.name.slice(0, 120),
        email: perfil.email,
        passwordHash,
        mustChangePassword: false,
        emailVerifiedAt: now,
      },
    });
    await tx.user.update({
      where: { id: userId },
      data: { googleSub: perfil.sub },
    });
    await tx.tenantSubscription.updateMany({
      where: { tenantId, trialEndsAt: null, activatedAt: null },
      data: { status: "TRIAL", trialEndsAt },
    });
    await audit(
      {
        tenantId,
        userId,
        actorEmail: perfil.email,
        action: "CREATE",
        entity: "Tenant",
        entityId: tenantId,
        newData: { tradeName, origem: "google" },
        ip,
      },
      tx,
    );
    return { tenantId, userId };
  });

  await AdminNotificationsService.notificarUsuarioCriado({
    tenantId: criado.tenantId,
    userId: criado.userId,
    tradeName,
    email: perfil.email,
    origem: "google",
  });

  logger.info({ tenantId: criado.tenantId, ip }, "Cadastro via Google — teste grátis liberado");
  return criado;
}

/** Cadastro público que ainda não clicou no e-mail: o Google vale como confirmação. */
async function concederTrialSePendente(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      tenantId: true,
      email: true,
      tenant: { select: { subscription: { select: { trialEndsAt: true, activatedAt: true } } } },
    },
  });
  if (!user?.tenantId) return;
  const sub = user.tenant?.subscription;
  if (!sub || sub.trialEndsAt || sub.activatedAt) return;

  const trialEndsAt = trialEndFrom(new Date());
  await prisma.tenantSubscription.updateMany({
    where: { tenantId: user.tenantId, trialEndsAt: null, activatedAt: null },
    data: { status: "TRIAL", trialEndsAt },
  });
  await audit({
    tenantId: user.tenantId,
    userId,
    actorEmail: user.email,
    action: "UPDATE",
    entity: "TenantSubscription",
    entityId: user.tenantId,
    newData: { status: "TRIAL", origem: "google" },
  });
}
