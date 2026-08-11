import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { PageHeader } from "@/components/data/page-header";
import { HigienizacaoForm } from "../../nova/_components/higienizacao-form";

export const dynamic = "force-dynamic";

export default async function EditarHigienizacaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const [c, saldo] = await Promise.all([
    HigienizacaoService.get(tenantId, id).catch(() => null),
    CaixasService.getSaldo(tenantId),
  ]);
  if (!c) notFound();

  return (
    <div>
      <PageHeader
        title="Editar envio"
        description="Disponível apenas antes de qualquer devolução ou pagamento."
      />
      <HigienizacaoForm
        caixasSujas={saldo.sujas}
        initial={{
          id: c.id,
          cleanerName: c.cleanerName,
          sentDate: c.sentDate.toISOString().slice(0, 10),
          sentQty: c.sentQty,
          unitPrice: Number(c.unitPrice),
          notes: c.notes,
        }}
      />
    </div>
  );
}
