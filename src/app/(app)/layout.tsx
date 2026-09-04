import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { billingNotice } from "@/lib/billing/status";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/layout/app-shell";
import { SessaoViva } from "@/components/auth/sessao-viva";
import { accessTokenMaxAgeSeconds } from "@/lib/auth/jwt";

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
      subscription: { select: { trialEndsAt: true, cancelledAt: true, currentPeriodEnd: true } },
    },
  });

  // Primeiro acesso → onboarding guiado.
  if (tenant && !tenant.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  // Três situações, três mensagens: teste acabando, mensalidade vencida, e
  // cancelamento com período pago ainda valendo.
  const notice = billingNotice({
    subStatus: session.subStatus,
    trialEndsAt: tenant?.subscription?.trialEndsAt ?? null,
    cancelledAt: tenant?.subscription?.cancelledAt ?? null,
    currentPeriodEnd: tenant?.subscription?.currentPeriodEnd ?? null,
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
        : notice?.kind === "cancelled"
          ? `Assinatura cancelada — você usa o sistema até ${formatDate(notice.accessUntil)}. Não haverá próxima cobrança.`
          : null;
  const billingCta =
    notice?.kind === "cancelled"
      ? { href: "/plano", label: "Ver plano" }
      : undefined;

  return (
    <AppShell
      companyName={tenant?.tradeName ?? "Minha empresa"}
      userName={session.name}
      billingWarning={billingWarning}
      billingCta={billingCta}
      trialLabel={
        notice?.kind === "trial_ending"
          ? notice.daysLeft <= 0
            ? "trial hoje"
            : `${notice.daysLeft}d trial`
          : null
      }
      modules={session.modules}
      isSuperAdmin={session.role === "SUPER_ADMIN"}
      // Sempre true aqui, e isso NAO ignora as regras do convite: este layout so
      // chega a renderizar depois dos redirects acima, ou seja, com a senha ja
      // trocada e o onboarding concluido. Quem termina o wizard e mandado para
      // /dashboard, que passa por aqui — e o convite aparece nesse momento.
      // O proprio InstallPrompt cuida do resto (app instalado, "Agora nao").
      showInstallPrompt
    >
      {/*
        Renova a sessao enquanto o app esta em uso. O TTL vem do servidor para
        nao haver duas contas de tempo divergindo: se alguem encurtar
        ACCESS_TOKEN_TTL, a renovacao acompanha.
      */}
      <SessaoViva tokenTtlSegundos={accessTokenMaxAgeSeconds()} />
      {children}
    </AppShell>
  );
}
