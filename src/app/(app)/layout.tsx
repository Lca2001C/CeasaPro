import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { accessDecision } from "@/lib/billing/status";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/alterar-senha");
  if (session.role === "SUPER_ADMIN") redirect("/admin");
  if (!session.tenantId) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { tradeName: true, onboardingCompletedAt: true },
  });

  // Primeiro acesso → onboarding guiado.
  if (tenant && !tenant.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  const decision = accessDecision(session.tenantStatus, session.subStatus);
  const billingWarning =
    decision === "warn"
      ? "Sua assinatura venceu. Regularize para não perder o acesso."
      : null;

  return (
    <AppShell
      companyName={tenant?.tradeName ?? "Minha empresa"}
      userName={session.name}
      billingWarning={billingWarning}
    >
      {children}
    </AppShell>
  );
}
