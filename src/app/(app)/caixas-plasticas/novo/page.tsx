import { requireTenant } from "@/lib/auth/session";
import { CaixasService } from "@/lib/services/caixas.service";
import { PageHeader } from "@/components/data/page-header";
import { MovimentoCaixaForm } from "./_components/movimento-form";

export const dynamic = "force-dynamic";

export default async function NovoMovimentoCaixaPage() {
  const { tenantId } = await requireTenant();
  const saldo = await CaixasService.getSaldo(tenantId);

  return (
    <div>
      <PageHeader
        title="Movimentar caixas"
        description="Entrada, saída para cliente, retorno, higienização ou quebra."
      />
      <MovimentoCaixaForm saldo={saldo} />
    </div>
  );
}
