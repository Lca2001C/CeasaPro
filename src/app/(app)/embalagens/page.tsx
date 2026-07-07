import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { excluirVendaEmbalagem } from "@/actions/embalagens.actions";
import { formatBRL, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DeleteButton } from "@/components/crud/delete-button";
import { TipoEmbalagemForm } from "./_components/tipo-form";

export const dynamic = "force-dynamic";

export default async function EmbalagensPage() {
  const { tenantId } = await requireTenant();
  const [{ vendas, total, totalQtd }, tipos] = await Promise.all([
    EmbalagensService.listSales(tenantId),
    EmbalagensService.listTypes(tenantId),
  ]);

  return (
    <div>
      <PageHeader
        title="Venda de embalagens"
        description="Caixas, sacaria e outras embalagens vendidas à parte."
        action={
          <Button asChild size="sm">
            <Link href="/embalagens/nova">
              <Plus /> Nova venda
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard label="Embalagens vendidas" value={String(totalQtd)} />
        <StatCard label="Total vendido" value={formatBRL(total)} tone="success" />
      </div>

      <Tabs defaultValue="vendas">
        <TabsList>
          <TabsTrigger value="vendas">Vendas</TabsTrigger>
          <TabsTrigger value="tipos">Tipos</TabsTrigger>
        </TabsList>

        <TabsContent value="vendas">
          {vendas.length === 0 ? (
            <EmptyState
              title="Nenhuma venda de embalagem"
              description="Toque em Nova venda para registrar."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {vendas.map((v) => (
                <Card key={v.id} className="flex items-center justify-between p-3">
                  <div className="min-w-0">
                    <span className="truncate font-medium">{v.type.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(v.saleDate)} · {v.quantity} un ·{" "}
                      {v.customerName ?? "Cliente"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold tabular-nums">
                      {formatBRL(v.totalAmount)}
                    </span>
                    <DeleteButton
                      action={excluirVendaEmbalagem}
                      id={v.id}
                      entityLabel="esta venda de embalagem"
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tipos">
          <div className="flex flex-col gap-3">
            <TipoEmbalagemForm />
            <div className="flex flex-col gap-2">
              {tipos.map((t) => (
                <Card key={t.id} className="p-3 text-sm font-medium">
                  {t.name}
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
