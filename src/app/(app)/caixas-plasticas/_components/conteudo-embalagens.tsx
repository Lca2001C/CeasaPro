import { Info } from "lucide-react";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { formatBRL, formatDate } from "@/lib/format";
import { APP_TIME_ZONE } from "@/lib/tz";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { TipoEmbalagemForm } from "./embalagens/tipo-form";
import { EstoqueTipo } from "./embalagens/estoque-tipo";
import { NovaVendaEmbalagem } from "./embalagens/nova-venda";
import { CancelarVendaEmbalagem } from "./embalagens/cancelar-venda";

/**
 * A aba "Embalagens": papelão, sacaria e afins vendidos à parte — o cliente
 * leva e não devolve. Vendas do mês, tipos com o estoque de cada um e a venda
 * nova, que abre por cima da tela (folha no celular).
 */
export async function ConteudoEmbalagens({
  tenantId,
  abrirNovaVenda,
  temCaixas,
}: {
  tenantId: string;
  /** `?nova=1` — o atalho antigo `/embalagens/nova` cai aqui com a venda aberta. */
  abrirNovaVenda: boolean;
  /** Com o módulo de caixas, o aviso aponta para a aba ao lado. */
  temCaixas: boolean;
}) {
  const [{ vendas, total, totalQtd }, tipos, saldos] = await Promise.all([
    EmbalagensService.listSales(tenantId),
    EmbalagensService.listTypes(tenantId),
    EmbalagensService.saldos(tenantId),
  ]);
  const ativos = tipos.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }));
  const mesAtual = new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="flex flex-col gap-5">
      <NovaVendaEmbalagem tipos={ativos} abrirAoCarregar={abrirNovaVenda} />

      {/* Os dois "negócios de caixa" do box: confundi-los é o erro mais caro
          aqui — lançar uma caixa retornável como venda avulsa some com ela do
          controle de devolução. */}
      <Card className="flex items-start gap-3 p-4 text-sm">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />
        <span className="text-muted-foreground">
          Aqui é a <b className="text-foreground">venda avulsa</b> de papelão, sacaria e
          afins — o cliente leva e não devolve.{" "}
          {temCaixas ? (
            <>
              As caixas plásticas que saem <b className="text-foreground">emprestadas</b> com
              a mercadoria ficam na aba ao lado.
            </>
          ) : (
            <>
              Caixa plástica <b className="text-foreground">emprestada</b>, que volta, não se
              lança aqui.
            </>
          )}
        </span>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {/* Totais do MÊS corrente, somados no banco — não da lista abaixo,
            que mostra só as 100 vendas mais recentes. */}
        <StatCard label="Vendidas no mês" value={String(totalQtd)} hint={mesAtual} />
        <StatCard
          label="Total vendido no mês"
          value={formatBRL(total)}
          hint={mesAtual}
          tone="success"
        />
      </div>

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
          Vendas de embalagem
        </h2>
        {vendas.length === 0 ? (
          <EmptyState
            title="Nenhuma venda de embalagem"
            description="Toque em Nova venda de embalagem para registrar."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {vendas.map((v) => (
              <Card key={v.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{v.type.name}</span>
                    {v.cancelledAt && <Badge variant="destructive">Cancelada</Badge>}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {formatDate(v.saleDate)} · {v.quantity} un ·{" "}
                    {v.customerName ?? "Cliente"}
                    {v.cancelReason ? ` · ${v.cancelReason}` : ""}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                  <span
                    className={cn(
                      "font-bold tabular-nums",
                      v.cancelledAt && "text-muted-foreground line-through",
                    )}
                  >
                    {formatBRL(v.totalAmount)}
                  </span>
                  {v.podeCancelar && (
                    <CancelarVendaEmbalagem
                      id={v.id}
                      descricao={`${v.quantity} ${v.type.name}`}
                    />
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="px-1">
          <h2 className="text-sm font-semibold text-muted-foreground">Tipos e estoque</h2>
          <p className="text-sm text-muted-foreground">
            Os tipos que você revende. Ligue o estoque de um tipo para a venda dar baixa nele.
          </p>
        </div>
        <TipoEmbalagemForm />
        {tipos.length > 0 && (
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
        )}
      </section>
    </div>
  );
}
