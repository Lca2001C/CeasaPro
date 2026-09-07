import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { empresaSemNome } from "@/lib/tenant-defaults";
import { OnboardingWizard } from "./_components/wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { tenantId } = await requireTenant();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tradeName: true, onboardingCompletedAt: true },
  });
  if (tenant?.onboardingCompletedAt) redirect("/dashboard");
  return (
    <OnboardingWizard
      // O nome de partida NÃO é pré-preenchido: deixá-lo no campo faria a pessoa
      // clicar "Continuar" e carimbá-lo como escolha dela, e o aviso de cadastro
      // incompleto sumiria sem nada ter sido preenchido.
      initialName={empresaSemNome(tenant?.tradeName) ? "" : (tenant?.tradeName ?? "")}
    />
  );
}
