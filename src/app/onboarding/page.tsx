import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { sessaoAindaValida } from "@/lib/auth/revogacao";
import { rotaDeSessaoRevogada } from "@/lib/auth/renovacao";
import { prisma } from "@/lib/db/prisma";
import { empresaSemNome } from "@/lib/tenant-defaults";
import { OnboardingWizard } from "./_components/wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { session, tenantId } = await requireTenant();
  // Fora do grupo `(app)`, então sem o layout que recusa sessão revogada.
  if (!(await sessaoAindaValida(session))) redirect(rotaDeSessaoRevogada("/onboarding"));
  // Busca os campos que o passo 1 EDITA — nome, telefone e endereço.
  //
  // Telefone e endereço não vinham, e o formulário partia de string vazia: o
  // primeiro "Continuar" gravava vazio por cima do telefone do cadastro, que é
  // o único contato do box. Os campos que este passo NÃO edita (razão social,
  // CNPJ, horário, UF, tipo de estabelecimento) não precisam ser buscados nem
  // devolvidos: `updateCompany` não toca em chave ausente. Ver o comentário
  // longo em `saveCompany`, no wizard.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      tradeName: true,
      onboardingCompletedAt: true,
      phone: true,
      address: true,
    },
  });
  if (tenant?.onboardingCompletedAt) redirect("/dashboard");
  return (
    <OnboardingWizard
      // O nome de partida NÃO é pré-preenchido quando ainda é o placeholder do
      // cadastro mínimo: deixá-lo no campo faria a pessoa clicar "Continuar" e
      // carimbá-lo como escolha dela, e o aviso de cadastro incompleto sumiria
      // sem nada ter sido preenchido.
      initialName={empresaSemNome(tenant?.tradeName) ? "" : (tenant?.tradeName ?? "")}
      // Telefone e endereço partiam de string vazia porque a página só buscava o
      // nome — e o passo 1 então gravava vazio por cima do que o cadastro tinha.
      initialPhone={tenant?.phone ?? ""}
      initialAddress={tenant?.address ?? ""}
    />
  );
}
