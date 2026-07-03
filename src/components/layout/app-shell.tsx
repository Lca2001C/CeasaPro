"use client";

import { LogOut } from "lucide-react";
import { BottomNav } from "./bottom-nav";
import { SideNav } from "./side-nav";
import { Button } from "@/components/ui/button";

interface Props {
  companyName: string;
  userName: string;
  billingWarning?: string | null;
  children: React.ReactNode;
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export function AppShell({ companyName, userName, billingWarning, children }: Props) {
  return (
    <div className="flex min-h-screen">
      <SideNav />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{companyName}</p>
            <p className="truncate text-xs text-muted-foreground">{userName}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair">
            <LogOut className="size-5" />
          </Button>
        </header>

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

        <BottomNav />
      </div>
    </div>
  );
}
