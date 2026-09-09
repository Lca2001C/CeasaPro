"use client";

import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sair } from "@/lib/sair";

export function LogoutButton({ variant = "ghost" }: { variant?: "ghost" | "outline" }) {
  return (
    <Button variant={variant} onClick={() => void sair(toast.error)}>
      <LogOut /> Sair
    </Button>
  );
}
