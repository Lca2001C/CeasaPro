import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { billingNotice } from "@/lib/billing/status";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/alterar-senha");
  // O super-admin usa esta área no ambiente PRÓPRIO dele. Sem ambiente
  // provisionado não há o que mostrar aqui — volta para a gestão do sistema.
  if (session.role === "SUPER_ADMIN" && !session.tenantId) redirect("/admin");
  if (!session.tenantId) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: {
      tradeName: true,
      onboardingCompletedAt: true,
      subscription: { select: { trialEndsAt: true } },
    },
  });

  // Primeiro acesso → onboarding guiado.
  if (tenant && !tenant.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  // Duas situações, duas mensagens: teste acabando (nunca pagou, precisa
  // contratar) e mensalidade vencida (é cliente, precisa regularizar).
  const notice = billingNotice({
    subStatus: session.subStatus,
    trialEndsAt: tenant?.subscription?.trialEndsAt ?? null,
  });
  const billingWarning =
    notice?.kind === "trial_ending"
      ? notice.daysLeft <= 0
        ? "Seu teste grátis termina hoje. Contrate um plano para continuar usando."
        : `Seu teste grátis termina em ${notice.daysLeft} ${
            notice.daysLeft === 1 ? "dia" : "dias"
          }. Contrate um plano para não perder o acesso.`
      : notice?.kind === "overdue"
        ? "Sua assinatura venceu. Regularize para não perder o acesso."
        : null;

  return (
    <AppShell
      companyName={tenant?.tradeName ?? "Minha empresa"}
      userName={session.name}
      billingWarning={billingWarning}
      modules={session.modules}
      isSuperAdmin={session.role === "SUPER_ADMIN"}
    >
      {children}
    </AppShell>
  );
}
