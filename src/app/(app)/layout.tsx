import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { assertSessaoValida } from "@/lib/auth/revogacao";
import { prisma } from "@/lib/db/prisma";
import { accessDecision, billingNotice } from "@/lib/billing/status";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/layout/app-shell";
import { SessaoViva } from "@/components/auth/sessao-viva";
import { accessTokenMaxAgeSeconds } from "@/lib/auth/jwt";
import { NOME_EMPRESA_PADRAO } from "@/lib/tenant-defaults";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/alterar-senha");
  await assertSessaoValida(session);
  // Assinatura bloqueada não lê dado da empresa.
  //
  // Isto ESPELHA o proxy, que já decide o mesmo — e é justamente esse o ponto:
  // até aqui, a única camada que decidia assinatura para uma NAVEGAÇÃO era o
  // middleware. Os wrappers de escrita já se defendiam sozinhos (`assertActive`
  // em `with-action`/`with-route`); a leitura de página, não.
  //
  // Sem mudança de comportamento: `/conta` e `/assinatura` ficam fora deste
  // grupo, e `/plano`, que está dentro, não é rota de regularização — o proxy
  // já mandava o bloqueado para `/conta/suspensa` antes de chegar nela.
  if (accessDecision(session.tenantStatus, session.subStatus) === "blocked") {
    redirect("/conta/suspensa");
  }
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

  // O onboarding deixou de ser obrigatório.
  //
  // Antes daqui saía um `redirect("/onboarding")` para quem tinha
  // `onboardingCompletedAt` nulo. Com o cadastro pedindo só e-mail e senha, isso
  // significaria trocar um formulário longo por outro — a pessoa entraria no
  // sistema e daria de cara com três passos antes de ver qualquer coisa.
  //
  // O wizard continua existindo e continua valendo a pena (ele cria o primeiro
  // fornecedor e o primeiro produto), mas agora é CONVITE: o cartão no Início,
  // que a pessoa aceita ou dispensa. `onboardingCompletedAt` mudou de sentido
  // junto — passou de "passou pelo wizard" para "o convite já foi resolvido".

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
      companyName={tenant?.tradeName ?? NOME_EMPRESA_PADRAO}
      userName={session.name}
      userEmail={session.email}
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
      // Um convite de cada vez.
      //
      // Isto era `true` fixo, e o comentário justificava dizendo que o layout só
      // renderizava depois do onboarding concluído. Deixou de ser verdade quando
      // o onboarding virou opcional: o convite de instalar o app é MODAL, e
      // abriria por cima do cartão de completar cadastro e do convite ao tour —
      // três pedidos na primeira tela, e os dois de baixo dispensados sem
      // leitura. Enquanto o cartão do Início estiver de pé, o modal espera.
      // O proprio InstallPrompt cuida do resto (app instalado, "Agora nao").
      showInstallPrompt={Boolean(tenant?.onboardingCompletedAt)}
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
