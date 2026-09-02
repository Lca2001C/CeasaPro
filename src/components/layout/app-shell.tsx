"use client";

import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";
import { BottomNav } from "./bottom-nav";
import { SideNav } from "./side-nav";
import { Button } from "@/components/ui/button";
import { SupportButton } from "@/components/support-button";
import { encerrarSessao } from "@/lib/session-nav";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { NetworkStatus } from "@/components/pwa/network-status";

interface Props {
  companyName: string;
  userName: string;
  billingWarning?: string | null;
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
  userName,
  billingWarning,
  modules,
  isSuperAdmin,
  showInstallPrompt = false,
  children,
}: Props) {
  return (
    <div className="flex min-h-screen">
      <SideNav modules={modules} />
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
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{companyName}</p>
            <p className="truncate text-xs text-muted-foreground">{userName}</p>
          </div>
          <div className="flex items-center gap-1">
            {isSuperAdmin && (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin">
                  <ShieldCheck className="size-4" />
                  <span className="hidden sm:inline">Gestão do sistema</span>
                </Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void encerrarSessao()}
              aria-label="Sair"
            >
              <LogOut className="size-5" />
            </Button>
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
            <a href="/assinatura" className="font-semibold underline">
              Pagar agora
            </a>
          </div>
        )}

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 pb-24 md:pb-8">
          {children}
        </main>

        <InstallPrompt autoOpen={showInstallPrompt} />
        <SupportButton companyName={companyName} />
        <BottomNav modules={modules} />
      </div>
    </div>
  );
}
