import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { OnboardingWizard } from "./_components/wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { tenantId } = await requireTenant();
  // Busca TODOS os campos da empresa, não só o nome.
  //
  // O passo 1 salva os seis campos de uma vez (`ConfigService.updateCompany`
  // grava incondicionalmente), então o que a tela não conhecer é apagado. O
  // telefone é OBRIGATÓRIO no cadastro público e é o único contato do box; e a
  // empresa criada pelo admin já vem com CNPJ e razão social digitados pelo
  // suporte. Tudo isso ia embora no primeiro clique em "Continuar".
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      tradeName: true,
      onboardingCompletedAt: true,
      phone: true,
      address: true,
      legalName: true,
      cnpj: true,
      businessHours: true,
    },
  });
  if (tenant?.onboardingCompletedAt) redirect("/dashboard");
  return (
    <OnboardingWizard
      initialName={tenant?.tradeName ?? ""}
      initialPhone={tenant?.phone ?? ""}
      initialAddress={tenant?.address ?? ""}
      // Não são editados no onboarding: viajam só para não serem apagados.
      preservar={{
        legalName: tenant?.legalName ?? null,
        cnpj: tenant?.cnpj ?? null,
        businessHours: tenant?.businessHours ?? null,
      }}
    />
  );
}
