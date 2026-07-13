"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  PlusCircle,
  Package,
  HandCoins,
  Boxes,
  Truck,
  ShoppingBag,
  Receipt,
  Wallet,
  FileBarChart,
  Settings,
  ShieldCheck,
  Container,
  Droplets,
  PackageOpen,
  History,
  BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { moduleForPath, isModuleEnabled } from "@/lib/plan/modules";

const items = [
  { href: "/dashboard", label: "Início", icon: Home },
  { href: "/vendas/nova", label: "Vender (PDV)", icon: PlusCircle },
  { href: "/produtos", label: "Produtos", icon: Boxes },
  { href: "/fornecedores", label: "Fornecedores", icon: Truck },
  { href: "/compras", label: "Compras", icon: ShoppingBag },
  { href: "/vendas", label: "Vendas", icon: Receipt },
  { href: "/fiado", label: "Fiado", icon: HandCoins },
  { href: "/estoque", label: "Estoque", icon: Package },
  { href: "/despesas", label: "Despesas", icon: Wallet },
  { href: "/caixas-plasticas", label: "Caixas plásticas", icon: Container },
  { href: "/higienizacao", label: "Higienização", icon: Droplets },
  { href: "/embalagens", label: "Embalagens", icon: PackageOpen },
  { href: "/relatorios", label: "Relatórios", icon: FileBarChart },
<<<<<<< HEAD
  { href: "/auditoria", label: "Auditoria", icon: ShieldCheck },
=======
  { href: "/atividades", label: "Atividades", icon: History },
  { href: "/plano", label: "Meu plano", icon: BadgeCheck },
>>>>>>> 3dd6880 (feat/adicionando teste e CI/CD)
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

/** Barra lateral fixa no desktop (>= md). No mobile usa-se a BottomNav. */
export function SideNav({ modules }: { modules?: string[] }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const visible = items.filter((item) => {
    const m = moduleForPath(item.href);
    return !m || isModuleEnabled(modules, m);
  });
  return (
    <aside className="hidden w-60 shrink-0 border-r md:block">
      <div className="sticky top-0 flex h-screen flex-col p-3">
        <div className="px-2 py-3 text-lg font-bold text-primary">CeasaPro</div>
        <nav className="mt-2 flex flex-col gap-1 overflow-y-auto">
          {visible.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
