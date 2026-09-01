import { Suspense } from "react";
import { TRIAL_DAYS } from "@/lib/billing/status";
import { LoginForm } from "./_components/login-form";

// Renderizada por requisição para receber o nonce do CSP (ver `src/proxy.ts`).
// Pré-renderizada em build, o HTML sairia sem nonce e o `'strict-dynamic'` do
// script-src bloquearia todo o JS desta página — o formulário de login pararia.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm trialDays={TRIAL_DAYS} />
    </Suspense>
  );
}
