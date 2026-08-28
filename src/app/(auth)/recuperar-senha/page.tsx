import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ForgotForm } from "./_components/forgot-form";

export const metadata: Metadata = {
  title: "Esqueci minha senha",
  robots: { index: false, follow: false },
};

// Renderizada por requisição para receber o nonce do CSP (ver `src/proxy.ts`).
export const dynamic = "force-dynamic";

export default function ForgotPage() {
  return (
    <Card>
      <CardContent className="pt-6">
        <ForgotForm />
      </CardContent>
    </Card>
  );
}
