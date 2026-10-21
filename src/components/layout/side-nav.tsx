"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  PlusCircle,
  Package,
  HandCoins,
  Truck,
  Receipt,
  Wallet,
  FileBarChart,
  Settings,
  Container,
  Droplets,
  TrendingUp,
  Newspaper,
  LogOut,
  Sprout,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { rotaLiberada } from "@/lib/plan/modules";
import { toast } from "sonner";
import { sair } from "@/lib/sair";
import { hrefAtual } from "./item-atual";

const items = [
  { href: "/dashboard", label: "Início", icon: Home },
  { href: "/vendas/nova", label: "Vender (PDV)", icon: PlusCircle },
  // Produtos e Compras vivem dentro do Estoque (cadastro, entrada e saldo).
  { href: "/estoque", label: "Estoque", icon: Package },
  { href: "/fornecedores", label: "Fornecedores", icon: Truck },
  { href: "/vendas", label: "Vendas e clientes", icon: Receipt },
  { href: "/fiado", label: "Fiado", icon: HandCoins },
  { href: "/cotacoes", label: "Cotações", icon: TrendingUp },
  { href: "/ceasanews", label: "CeasaNews", icon: Newspaper },
  { href: "/despesas", label: "Despesas", icon: Wallet },
  // Caixas e embalagens são uma tela só, em abas; os módulos seguem separados.
  { href: "/caixas-plasticas", label: "Caixas e embalagens", icon: Container },
  { href: "/higienizacao", label: "Higienização", icon: Droplets },
  { href: "/relatorios", label: "Relatórios", icon: FileBarChart },
  // Auditoria é da administração da plataforma (`/admin/auditoria`), não do
  // dia a dia do box: mistura eventos técnicos com operação e não tem ação
  // associada para quem está vendendo.
  // O guia e o tour ficam no botão Tutorial do header, não no menu operacional.
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

/** Barra lateral fixa no desktop (>= md). No mobile usa-se a BottomNav. */
export function SideNav({
  modules,
  companyName,
  userName,
  trialLabel,
}: {
  modules?: string[];
  companyName?: string;
  userName?: string;
  trialLabel?: string | null;
}) {
  const pathname = usePathname();
  const visible = items.filter((item) => rotaLiberada(modules, item.href));
  // Um item ativo só: ver `hrefAtual` (em /vendas/nova, "Vendas" também casava).
  const atual = hrefAtual(
    visible.map((i) => i.href),
    pathname,
  );
  return (
    <aside
      // Âncora do tour guiado; a barra de baixo tem a dela. Ver `nav-mobile`.
      data-tour="nav-desktop"
      className="hidden w-64 shrink-0 border-r border-border/60 bg-lateral md:block"
    >
      <div className="sticky top-0 flex h-screen flex-col p-3">
        <div className="flex items-center gap-2 px-3 py-3 text-xl font-bold tracking-tight">
          <Sprout aria-hidden className="size-6 text-primary" />
          <span>
            Ceasa<span className="text-primary">Pro</span>
          </span>
        </div>
        {/*
          O rótulo distingue esta navegação das outras do documento. Sem ele o
          leitor de tela anuncia só "navegação", e quem usa a lista de marcos
          para se orientar não sabe em qual entrou.
        */}
        <nav aria-label="Menu principal" className="mt-2 flex flex-col gap-1 overflow-y-auto">
          {visible.map((item) => {
            const Icon = item.icon;
            const active = item.href === atual;
            return (
              <Link
                key={item.href}
                href={item.href}
                /*
                  Até aqui a tela ATUAL era marcada só por cor de fundo. Cor
                  sozinha não chega a quem usa leitor de tela, e não chega a
                  quem não distingue as duas cores — a pessoa perde a única
                  pista de onde está dentro do app.
                */
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-full px-4 text-sm outline-none motion-safe:transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  // Verde só no item selecionado; o resto do menu fica neutro.
                  active
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t pt-3">
          {(companyName || trialLabel) && (
            <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
              {companyName && (
                <p className="truncate text-xs font-semibold text-accent-foreground">
                  {companyName}
                </p>
              )}
              {trialLabel && (
                <p className="truncate text-xs text-muted-foreground">{trialLabel}</p>
              )}
            </div>
          )}
          {userName && (
            <p className="truncate px-3 text-sm font-medium">{userName}</p>
          )}
          <button
            type="button"
            onClick={() => void sair(toast.error)}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-muted px-3 text-sm font-semibold text-foreground outline-none motion-safe:transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="size-5" />
            Sair
          </button>
        </div>
      </div>
    </aside>
  );
}
