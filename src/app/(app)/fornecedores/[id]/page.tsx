import { notFound } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
import { formatBRL, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardDeResumo } from "@/components/ui/card-de-resumo";
import { SITUACAO_COMPRA_LABELS, situacaoDaCompra } from "@/lib/despesas/situacao-compra";
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
    <div>
      <PageHeader title="Editar fornecedor" />

      <div className="flex flex-col gap-5">
        <Card className="p-4 sm:p-5">
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
        </Card>

        {/* O que ainda devo a este fornecedor — compras a prazo e contas
            lançadas com ele. O cartão inteiro abre as contas pendentes. */}
        <CardDeResumo
          rotulo="Em aberto com este fornecedor"
          valor={formatBRL(aberto.total)}
          dica={`${aberto.contas} conta(s) a pagar`}
          icone={<ReceiptText />}
          tom={aberto.contas > 0 ? "warning" : "neutro"}
          tomDoValor={aberto.contas > 0 ? "warning" : undefined}
          href={`/despesas?status=PENDENTE&fornecedor=${f.id}`}
        />

        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 px-1">
            <h2 className="text-sm font-semibold text-muted-foreground">Histórico de compras</h2>
            <span className="text-sm text-muted-foreground">Últimas 50 compras</span>
          </div>

          {compras.length === 0 ? (
            <EmptyState
              title="Nenhuma compra deste fornecedor"
              description="As compras vinculadas a este fornecedor aparecerão aqui."
              icon={<ReceiptText />}
            />
          ) : (
            <Card className="divide-y divide-border/70 overflow-hidden">
              {compras.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold tabular-nums">{formatDate(c.purchaseDate)}</p>
                    {c.notes && (
                      <p className="truncate text-sm text-muted-foreground">{c.notes}</p>
                    )}
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <SituacaoBadge situacao={situacaoDaCompra(c.expenses[0], agora)} />
                    <span className="font-bold tabular-nums">{formatBRL(c.totalAmount)}</span>
                  </span>
                </div>
              ))}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function SituacaoBadge({ situacao }: { situacao: ReturnType<typeof situacaoDaCompra> }) {
  if (situacao === "SEM_CONTA") return null;
  const variant =
    situacao === "PAGA" ? "success" : situacao === "VENCIDA" ? "destructive" : "warning";
  return <Badge variant={variant}>{SITUACAO_COMPRA_LABELS[situacao]}</Badge>;
}
