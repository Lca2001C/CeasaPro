import type { Metadata } from "next";
import { TRIAL_DAYS } from "@/lib/billing/status";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = {
  title: "Criar conta — CeasaPro",
  description: `Teste o CeasaPro por ${TRIAL_DAYS} dias, sem cartão de crédito.`,
};

// Renderizada por requisição para receber o nonce do CSP (ver `src/proxy.ts`).
export const dynamic = "force-dynamic";

export default function CadastroPage() {
  return <SignupForm trialDays={TRIAL_DAYS} />;
}
