"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  PlusCircle,
  Package,
  HandCoins,
  Menu,
  Truck,
  Receipt,
  Wallet,
  FileBarChart,
  Settings,
  Container,
  Droplets,
  BadgeCheck,
  TrendingUp,
  LogOut,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { rotaLiberada } from "@/lib/plan/modules";
import { toast } from "sonner";
import { sair } from "@/lib/sair";
import { AtalhoDeTema } from "@/components/tema/controles-de-tema";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

const primary = [
  { href: "/dashboard", label: "Início", icon: Home },
  { href: "/vendas/nova", label: "Vender", icon: PlusCircle, highlight: true },
  { href: "/estoque", label: "Estoque", icon: Package },
  { href: "/fiado", label: "Fiado", icon: HandCoins },
];

const more = [
  // Produtos e Compras vivem dentro do Estoque (barra de baixo).
  { href: "/fornecedores", label: "Fornecedores", icon: Truck },
  { href: "/vendas", label: "Vendas (histórico)", icon: Receipt },
  { href: "/despesas", label: "Despesas", icon: Wallet },
  { href: "/cotacoes", label: "Cotações", icon: TrendingUp },
  // Caixas e embalagens são uma tela só, em abas; os módulos seguem separados.
  { href: "/caixas-plasticas", label: "Caixas e embalagens", icon: Container },
  { href: "/higienizacao", label: "Higienização", icon: Droplets },
  { href: "/relatorios", label: "Relatórios", icon: FileBarChart },
  // Auditoria vive na administração da plataforma (`/admin/auditoria`).
  // O guia e o tour ficam no botão Tutorial do header, não no menu Mais.
  { href: "/plano", label: "Meu plano", icon: BadgeCheck },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function BottomNav({
  modules,
  userName,
}: {
  modules?: string[];
  userName?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const allowed = (href: string) => rotaLiberada(modules, href);
  const moreItems = more.filter((item) => allowed(item.href));

  return (
    // O recuo de baixo é o que mantém os rótulos acima da barra de gestos do
    // iPhone: com `viewport-fit=cover` a nav encosta na borda física da tela, e
    // o toque na faixa da barra de gestos vai para o sistema, não para o app.
    <nav
      // Âncora do tour guiado. A lateral tem a dela; o tour destaca a que
      // estiver visível (ver `alvoVisivel` em `components/tour/tour-guiado`).
      /*
        Mesmo rótulo da barra lateral, e de propósito: as duas são a MESMA
        navegação em duas apresentações, e são excludentes por breakpoint
        (`md:hidden` aqui, `hidden md:block` lá). Como `display: none` tira da
        árvore de acessibilidade, nunca há duas ao mesmo tempo — e a pessoa
        ouve o mesmo nome no celular e no computador.
      */
      aria-label="Menu principal"
      data-tour="nav-mobile"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-lateral/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {primary.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              // Ver o mesmo comentário em `side-nav`: sem isto a tela atual é
              // marcada só por cor.
              aria-current={active ? "page" : undefined}
              className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 py-2 text-xs outline-none focus-visible:bg-muted/60"
            >
              {/*
                Ícone grande dentro de uma pílula: a pílula preenchida é a marca
                do item ATIVO (além do `aria-current`). "Vender" é a ação do
                balcão e fica sempre em verde cheio.
              */}
              <span
                aria-hidden
                className={cn(
                  "flex h-8 w-14 items-center justify-center rounded-full motion-safe:transition-colors",
                  item.highlight
                    ? "bg-primary text-primary-foreground shadow-suave"
                    : active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground",
                )}
              >
                <Icon className="size-6" />
              </span>
              <span
                className={cn(
                  "leading-none",
                  active ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium text-muted-foreground outline-none focus-visible:bg-muted/60">
            <span aria-hidden className="flex h-8 w-14 items-center justify-center rounded-full">
              <Menu className="size-6" />
            </span>
            <span className="leading-none">Mais</span>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-3 pb-4">
              {moreItems.map((item) => {
                const Icon = item.icon;
                return (
                  <SheetClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-border/60 bg-card p-3 text-center text-xs font-semibold shadow-suave outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        aria-hidden
                        className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"
                      >
                        <Icon className="size-5" />
                      </span>
                      {item.label}
                    </Link>
                  </SheetClose>
                );
              })}
            </div>
            <div className="border-t pt-3">
              <AtalhoDeTema className="mb-2" />
              {userName && (
                <p className="mb-2 truncate px-1 text-sm font-medium">{userName}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void sair(toast.error);
                }}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-muted px-3 text-sm font-semibold text-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LogOut className="size-5" />
                Sair
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

export { primary as primaryNav, more as moreNav };
