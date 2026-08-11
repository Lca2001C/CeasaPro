import { requireTenant } from "@/lib/auth/session";
import { CaixasService } from "@/lib/services/caixas.service";
import { PageHeader } from "@/components/data/page-header";
import { HigienizacaoForm } from "./_components/higienizacao-form";

export const dynamic = "force-dynamic";

export default async function NovaHigienizacaoPage() {
  const { tenantId } = await requireTenant();
  const saldo = await CaixasService.getSaldo(tenantId);

  return (
    <div>
      <PageHeader
        title="Novo envio para higienização"
        description="As caixas sujas saem do estoque e voltam limpas na devolução."
      />
      <HigienizacaoForm caixasSujas={saldo.sujas} />
    </div>
  );
}
