"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { encerrarSessao } from "@/lib/session-nav";

export function LogoutButton({ variant = "ghost" }: { variant?: "ghost" | "outline" }) {
  return (
    <Button variant={variant} onClick={() => void encerrarSessao()}>
      <LogOut /> Sair
    </Button>
  );
}
