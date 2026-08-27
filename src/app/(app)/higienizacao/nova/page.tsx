import { requireTenant } from "@/lib/auth/session";
import { CaixasService } from "@/lib/services/caixas.service";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { PageHeader } from "@/components/data/page-header";
import { HigienizacaoForm } from "./_components/higienizacao-form";

export const dynamic = "force-dynamic";

export default async function NovaHigienizacaoPage({
  searchParams,
}: {
  /** `?qtd=` — atalho "enviar para higienizar" da tela de Caixas plásticas. */
  searchParams: Promise<{ qtd?: string }>;
}) {
  const { qtd } = await searchParams;
  const { tenantId } = await requireTenant();
  const [saldo, higienizadoresConhecidos] = await Promise.all([
    CaixasService.getSaldo(tenantId),
    HigienizacaoService.higienizadoresConhecidos(tenantId),
  ]);

  // Só sugere o que existe: um atalho com número maior que o saldo atual
  // (a página ficou aberta, alguém movimentou) viraria erro na hora de salvar.
  const sugerida = Number(qtd);
  const quantidadeSugerida =
    Number.isFinite(sugerida) && sugerida > 0
      ? String(Math.min(sugerida, saldo.sujas))
      : undefined;

  return (
    <div>
      <PageHeader
        title="Novo envio para higienização"
        description="As caixas sujas saem do estoque e voltam limpas na devolução."
      />
      <HigienizacaoForm
        caixasSujas={saldo.sujas}
        quantidadeSugerida={quantidadeSugerida}
        higienizadoresConhecidos={higienizadoresConhecidos}
      />
    </div>
  );
}
