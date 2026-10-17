"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { BottomNav } from "./bottom-nav";
import { BotaoTutorial } from "./botao-tutorial";
import { SideNav } from "./side-nav";
import { PularParaConteudo } from "./pular-para-conteudo";
import { Button } from "@/components/ui/button";
import { SupportButton } from "@/components/support-button";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { NetworkStatus } from "@/components/pwa/network-status";
import { TourGuiado } from "@/components/tour/tour-guiado";
import { BotaoModoEscuro } from "@/components/tema/controles-de-tema";
import { civilParts } from "@/lib/tz";

/** "Bom dia" / "Boa tarde" / "Boa noite" pelo relógio de Brasília, não o do aparelho. */
function saudacao(agora = new Date()): string {
  const h = civilParts(agora).hour;
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;
const inicial = (nome: string) => (nome.trim()[0] ?? "?").toUpperCase();

interface Props {
  companyName: string;
  userEmail?: string;
  userName: string;
  billingWarning?: string | null;
  trialLabel?: string | null;
  billingCta?: { href: string; label: string } | null;
  modules?: string[];
  /** Sessão de super-admin no ambiente próprio: mostra o caminho de volta. */
  isSuperAdmin?: boolean;
  /**
   * Abre o convite de instalacao sozinho. Falso enquanto o usuario tem algo
   * mais urgente a fazer (trocar senha, concluir onboarding) — ver o layout.
   */
  showInstallPrompt?: boolean;
  children: React.ReactNode;
}

export function AppShell({
  companyName,
  userEmail,
  userName,
  billingWarning,
  trialLabel,
  billingCta,
  modules,
  isSuperAdmin,
  showInstallPrompt = false,
  children,
}: Props) {
  const pathname = usePathname();
  // Na frente de caixa o botão de WhatsApp cobria o "Finalizar venda".
  const frenteDeCaixa = pathname.startsWith("/vendas/nova");
  const mostrarSuporte = !frenteDeCaixa;
  return (
    <div className="flex min-h-screen">
      {/*
        Primeiro elemento focável do documento, antes de qualquer navegação —
        é o que dá sentido a ele. Ver o comentário do componente.
      */}
      <PularParaConteudo />
      <SideNav
        modules={modules}
        companyName={companyName}
        userName={userName}
        trialLabel={trialLabel}
      />
      {/*
        `min-w-0` na coluna principal.

        `flex-1` é `flex: 1 1 0%`, mas item flex tem `min-width: auto` — ou seja,
        ele se recusa a encolher abaixo do conteúdo mínimo. Quando um valor longo
        aparecia numa tela estreita, quem cedia era a PÁGINA: ela ficava mais
        larga que o celular e passava a rolar de lado, cortando a coluna direita
        dos cartões. Com `min-w-0` a coluna encolhe e o conteúdo se ajusta
        dentro dela, que é o comportamento correto.
      */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/*
          A altura soma o recorte do topo (barra de status / notch) e o recuo
          empurra o conteúdo para baixo dele. Com `viewport-fit=cover` no
          viewport, sem isto o nome da empresa fica atrás da barra de status no
          app instalado. `env()` vale 0 no navegador e no Android — fora do
          iPhone o header continua com os mesmos 3.5rem.
        */}
        <header className="sticky top-0 z-30 flex h-[calc(4rem+env(safe-area-inset-top))] items-center justify-between gap-3 border-b border-border/60 bg-pagina/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
          {/* Saudação e empresa: quem abre o app vê de cara em qual box está. */}
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
            >
              {inicial(userName || companyName)}
            </span>
            <div className="min-w-0">
              {/* A hora do servidor e a do aparelho podem cruzar o meio-dia
                  entre a renderização e a hidratação. */}
              <p className="truncate text-sm font-semibold" suppressHydrationWarning>
                {saudacao()}, {primeiroNome(userName)}
              </p>
              <p className="truncate text-xs text-muted-foreground">{companyName}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <BotaoModoEscuro />
            <BotaoTutorial />
            {isSuperAdmin && (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin">
                  <ShieldCheck className="size-4" />
                  <span className="hidden sm:inline">Gestão do sistema</span>
                </Link>
              </Button>
            )}
          </div>
        </header>

        {isSuperAdmin && (
          // Faixa permanente: sem ela é fácil esquecer que este NÃO é o
          // ambiente de um cliente e concluir que "o sistema está vazio".
          <div className="bg-primary/10 px-4 py-1.5 text-center text-xs text-primary">
            Ambiente do administrador — dados de teste, separados dos clientes.
          </div>
        )}

        <NetworkStatus />

        {billingWarning && (
          <div className="bg-warning/15 px-4 py-2 text-center text-sm text-warning">
            {billingWarning}{" "}
            {billingCta !== null && (
              <a
                href={billingCta?.href ?? "/assinatura"}
                className="font-semibold underline"
              >
                {billingCta?.label ?? "Pagar agora"}
              </a>
            )}
          </div>
        )}

        {/*
          O recuo do fim acompanha a BottomNav, que agora é mais alta pelo
          recorte de baixo. Sem somar o mesmo `env()` aqui, o último cartão da
          lista ficaria escondido atrás da navegação no iPhone.
        */}
        <main
          id="conteudo"
          // Alvo do `PularParaConteudo`. `tabIndex={-1}` é o que faz o foco
          // realmente PARAR aqui: sem ele o navegador rola até a âncora mas
          // deixa o foco no link, e o próximo Tab volta para o começo da
          // navegação — o link pareceria funcionar para quem olha e não
          // funcionaria para quem usa teclado.
          tabIndex={-1}
          // A frente de caixa usa a largura toda: grade de produtos e pedido lado a lado.
          className={`mx-auto w-full ${frenteDeCaixa ? "max-w-7xl" : "max-w-3xl"} flex-1 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none md:pb-8`}
        >
          {children}
        </main>

        <InstallPrompt autoOpen={showInstallPrompt} />
        {mostrarSuporte && <SupportButton companyName={companyName} userEmail={userEmail} />}
        <BottomNav modules={modules} userName={userName} />

        {/*
          Motor do tour guiado. Não renderiza nada — destaca elementos das telas
          que passam por baixo dele. Fica no layout, e não nas páginas, porque é
          isso que permite ao tour atravessar rotas: uma navegação desmontaria
          um componente que morasse dentro da página.
        */}
        <TourGuiado modules={modules} />
      </div>
    </div>
  );
}
