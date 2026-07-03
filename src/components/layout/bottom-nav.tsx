"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  PlusCircle,
  Package,
  HandCoins,
  Menu,
  Boxes,
  Truck,
  ShoppingBag,
  Receipt,
  Wallet,
  FileBarChart,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
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
  { href: "/produtos", label: "Produtos", icon: Boxes },
  { href: "/fornecedores", label: "Fornecedores", icon: Truck },
  { href: "/compras", label: "Compras", icon: ShoppingBag },
  { href: "/vendas", label: "Vendas (histórico)", icon: Receipt },
  { href: "/despesas", label: "Despesas", icon: Wallet },
  { href: "/relatorios", label: "Relatórios", icon: FileBarChart },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {primary.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("size-6", item.highlight && "size-7")} />
              {item.label}
            </Link>
          );
        })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground">
            <Menu className="size-6" />
            Mais
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-3 pb-4">
              {more.map((item) => {
                const Icon = item.icon;
                return (
                  <SheetClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      className="flex flex-col items-center gap-2 rounded-lg border p-3 text-center text-xs font-medium hover:bg-accent"
                    >
                      <Icon className="size-6 text-primary" />
                      {item.label}
                    </Link>
                  </SheetClose>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

export { primary as primaryNav, more as moreNav };
