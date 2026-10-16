import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
import { formatBRL, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/data/stat-card";
import { SITUACAO_COMPRA_LABELS, situacaoDaCompra } from "@/lib/despesas/situacao-compra";
import Link from "next/link";
import { FornecedorForm } from "../_components/fornecedor-form";

export const dynamic = "force-dynamic";

export default async function EditarFornecedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const [f, compras, aberto] = await Promise.all([
    FornecedoresService.get(tenantId, id).catch(() => null),
    FornecedoresService.purchaseHistory(tenantId, id),
    FornecedoresService.emAberto(tenantId, id),
  ]);
  if (!f) notFound();
  const agora = new Date();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Editar fornecedor" />
      <FornecedorForm
        initial={{
          id: f.id,
          name: f.name,
          phone: f.phone ?? null,
          address: f.address ?? null,
          notes: f.notes ?? null,
          active: f.active,
        }}
      />

      {/* O que ainda devo a este fornecedor — compras a prazo e contas
          lançadas com ele. */}
      <Link href={`/despesas?status=PENDENTE&fornecedor=${f.id}`} className="block">
        <StatCard
          label="Em aberto com este fornecedor"
          value={formatBRL(aberto.total)}
          hint={`${aberto.contas} conta(s) a pagar`}
          tone={aberto.contas > 0 ? "warning" : "default"}
        />
      </Link>

      <Card>
        <CardContent className="pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Historico de compras</h2>
            <span className="text-xs text-muted-foreground">Ultimas 50 compras</span>
          </div>

          {compras.length === 0 ? (
            <EmptyState
              title="Nenhuma compra deste fornecedor"
              description="As compras vinculadas a este fornecedor aparecerao aqui."
            />
          ) : (
            <div className="flex flex-col divide-y">
              {compras.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{formatDate(c.purchaseDate)}</p>
                    {c.notes && (
                      <p className="truncate text-xs text-muted-foreground">{c.notes}</p>
                    )}
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <SituacaoBadge situacao={situacaoDaCompra(c.expenses[0], agora)} />
                    <span className="text-sm font-semibold tabular-nums">
                      {formatBRL(c.totalAmount)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SituacaoBadge({ situacao }: { situacao: ReturnType<typeof situacaoDaCompra> }) {
  if (situacao === "SEM_CONTA") return null;
  const variant =
    situacao === "PAGA" ? "success" : situacao === "VENCIDA" ? "destructive" : "warning";
  return <Badge variant={variant}>{SITUACAO_COMPRA_LABELS[situacao]}</Badge>;
}
