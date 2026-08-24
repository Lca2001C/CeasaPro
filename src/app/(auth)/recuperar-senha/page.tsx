import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ForgotForm } from "./_components/forgot-form";

export const metadata: Metadata = {
  title: "Esqueci minha senha",
  robots: { index: false, follow: false },
};

export default function ForgotPage() {
  return (
    <Card>
      <CardContent className="pt-6">
        <ForgotForm />
      </CardContent>
    </Card>
  );
}
