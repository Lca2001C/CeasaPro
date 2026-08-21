"use client";

import { MessageCircle } from "lucide-react";

/**
 * Botão flutuante de suporte via WhatsApp.
 *
 * O número vem de `NEXT_PUBLIC_SUPPORT_WHATSAPP` (DDI + DDD + número, só
 * dígitos). Sem a variável o componente não renderiza nada — assim uma
 * instalação sem canal de atendimento não exibe um botão quebrado.
 *
 * É só um link: sem estado, sem handler e sem hooks — nada de JavaScript extra
 * no celular do comerciante além da própria marcação.
 */
export function SupportButton({ companyName }: { companyName: string }) {
  const raw = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP;
  // `wa.me` só aceita dígitos; máscaras (+55 (31) 9...) quebram o link.
  const phone = raw?.replace(/\D/g, "") ?? "";
  if (!phone) return null;

  const message = `Olá! Preciso de ajuda no CeasaPro.\nEmpresa: ${companyName}`;
  const href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar com o suporte pelo WhatsApp"
      title="Falar com o suporte"
      // No mobile fica acima da BottomNav (z-40, ~56px de altura); no desktop,
      // onde a navegação é lateral, desce para o canto.
      className="fixed bottom-24 right-4 z-50 flex size-12 items-center justify-center rounded-full bg-success text-success-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-6"
    >
      <MessageCircle className="size-6" />
    </a>
  );
}
