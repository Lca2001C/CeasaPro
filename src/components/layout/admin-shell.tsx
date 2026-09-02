"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { encerrarSessao } from "@/lib/session-nav";
import { AbrirAmbienteButton } from "./abrir-ambiente-button";

const nav = [
  { href: "/admin", label: "Início" },
  { href: "/admin/clientes", label: "Clientes" },
  { href: "/admin/usuarios", label: "Usuários" },
  { href: "/admin/planos", label: "Planos" },
  { href: "/admin/pagamentos", label: "Pagamentos" },
  { href: "/admin/auditoria", label: "Auditoria" },
];

/**
 * Nome acessível da campainha.
 *
 * O número precisa estar aqui, e não só no balãozinho: o balão é `aria-hidden`
 * (senão o leitor de tela anuncia o número duas vezes), então este texto é a
 * única forma de saber quantos avisos há sem ver a tela.
 */
function rotuloCampainha(naoLidas: number, saturado: boolean): string {
  if (naoLidas === 0) return "Notificações";
  if (saturado) return "Notificações (mais de 99 não lidas)";
  return `Notificações (${naoLidas} não lida${naoLidas > 1 ? "s" : ""})`;
}

export function AdminShell({
  userName,
  naoLidas,
  naoLidasSaturado,
  children,
}: {
  userName: string;
  /** Notificações não lidas. Vem do servidor a cada navegação. */
  naoLidas: number;
  /** Passou do teto de contagem: mostra "99+" em vez de um número exato. */
  naoLidasSaturado: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <span className="font-bold text-primary">CeasaPro · Painel SaaS</span>
          <div className="flex items-center gap-2">
            {/*
              Campainha em vez de item de menu: é um estado que muda sozinho
              (alguém se cadastrou agora), e o valor está em ser visto sem que o
              admin precise ir procurar.
            */}
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={rotuloCampainha(naoLidas, naoLidasSaturado)}
            >
              <Link href="/admin/notificacoes">
                <Bell className="size-5" />
                {naoLidas > 0 && (
                  <span
                    className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground"
                    aria-hidden
                  >
                    {naoLidasSaturado ? "99+" : naoLidas}
                  </span>
                )}
              </Link>
            </Button>
            <AbrirAmbienteButton />
            <span className="hidden text-sm text-muted-foreground sm:inline">{userName}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void encerrarSessao()}
              aria-label="Sair"
            >
              <LogOut className="size-5" />
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-2 pb-2">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium",
                active(n.href) ? "bg-accent text-accent-foreground" : "text-muted-foreground",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-5">{children}</main>
    </div>
  );
}
