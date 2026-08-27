import Link from "next/link";
import { Info, Plus } from "lucide-react";
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
import { EstoqueTipo } from "./_components/estoque-tipo";

export const dynamic = "force-dynamic";

export default async function EmbalagensPage() {
  const { tenantId } = await requireTenant();
  const [{ vendas, total, totalQtd }, tipos, saldos] = await Promise.all([
    EmbalagensService.listSales(tenantId),
    EmbalagensService.listTypes(tenantId),
    EmbalagensService.saldos(tenantId),
  ]);

  return (
    <div>
      <PageHeader
        title="Venda de embalagens"
        description="Papelão, sacaria e caixas vendidas à parte — o cliente leva e não devolve."
        action={
          <Button asChild size="sm">
            <Link href="/embalagens/nova">
              <Plus /> Nova venda
            </Link>
          </Button>
        }
      />

      {/* Os dois "negócios de caixa" do box vivem em módulos diferentes, e
          confundi-los é o erro mais caro aqui: lançar uma caixa retornável
          como venda avulsa some com ela do controle de devolução. */}
      <Card className="mb-4 flex items-start gap-2 p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">
          Aqui é a <b className="text-foreground">venda avulsa</b> de papelão, sacaria e
          afins — o cliente leva e não devolve. As{" "}
          <Link href="/caixas-plasticas" className="font-medium text-primary underline underline-offset-2">
            caixas plásticas
          </Link>{" "}
          que saem <b className="text-foreground">emprestadas</b> com a mercadoria são
          controladas no módulo próprio, junto com o fiado e a higienização.
        </span>
      </Card>

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
                <EstoqueTipo
                  key={t.id}
                  id={t.id}
                  nome={t.name}
                  controlaEstoque={t.tracksStock}
                  saldo={t.tracksStock ? (saldos.get(t.id) ?? 0) : null}
                />
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
