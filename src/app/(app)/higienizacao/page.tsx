import Link from "next/link";
import { CartaoDeAcao } from "@/components/ui/cartao-de-acao";
import { HandCoins, PackageSearch, Plus, Sparkles } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { higienizacaoStatusEnum } from "@/lib/validations/higienizacao";
import { formatBRL, formatDate } from "@/lib/format";
import { CRATE_CLEANING_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListaDeAcoes, LinhaDeAcao } from "@/components/ui/linha-de-acao";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary"> = {
  ENVIADO: "warning",
  DEVOLVIDO: "secondary",
  PAGO: "success",
};

const FILTROS = [
  { value: "", label: "Todos" },
  { value: "ENVIADO", label: "Enviados" },
  { value: "DEVOLVIDO", label: "Devolvidos" },
  { value: "PAGO", label: "Pagos" },
] as const;

export default async function HigienizacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = higienizacaoStatusEnum.safeParse(rawStatus).data;

  const { tenantId } = await requireTenant();
  const {
    registros,
    caixasAReceber,
    totalAPagar,
    aguardandoDevolucao,
    aguardandoPagamento,
    saldo,
  } = await HigienizacaoService.list(tenantId, status);

  return (
    <div>
      <PageHeader
        title="Higienização"
        description="Fila de lavagem das caixas e o financeiro do serviço."
      />

      <CartaoDeAcao
        href="/higienizacao/nova"
        titulo="Novo Envio para Higienização"
        descricao="Mande caixas sujas para lavar e acompanhe a devolução"
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label="Sujas"
            value={String(saldo.sujas)}
            hint="Aguardando lavagem"
            tone="warning"
          />
          <StatCard
            label="Em higienização"
            value={String(saldo.emHigienizacao)}
            hint="Com o higienizador"
          />
          <StatCard
            label="Limpas"
            value={String(saldo.limpas)}
            hint="Prontas para vender"
            tone="success"
          />
          <StatCard label="Com clientes" value={String(saldo.comClientes)} />
          <StatCard label="Caixas a receber" value={String(caixasAReceber)} tone="warning" />
          <StatCard label="Total a pagar" value={formatBRL(totalAPagar)} tone="destructive" />
        </div>

        {/* O ciclo tem duas pendências com ações DIFERENTES — juntar as duas num
            "em aberto" só esconderia qual delas é a sua vez de resolver. */}
        {(aguardandoDevolucao > 0 || aguardandoPagamento > 0 || saldo.sujas > 0) && (
          <ListaDeAcoes titulo="O que fazer agora">
            {saldo.sujas > 0 && (
              <LinhaDeAcao
                href={`/higienizacao/nova?qtd=${saldo.sujas}`}
                icone={<Sparkles />}
                tom="warning"
                titulo={`${saldo.sujas} caixa(s) suja(s)`}
                descricao="Esperando lavagem — enviar ao higienizador"
              />
            )}
            {aguardandoDevolucao > 0 && (
              <LinhaDeAcao
                href="/higienizacao?status=ENVIADO"
                icone={<PackageSearch />}
                tom="neutro"
                titulo={`${aguardandoDevolucao} envio${aguardandoDevolucao > 1 ? "s" : ""} aguardando devolução`}
                descricao={`${caixasAReceber} caixa(s) a receber`}
              />
            )}
            {aguardandoPagamento > 0 && (
              <LinhaDeAcao
                href="/higienizacao?status=DEVOLVIDO"
                icone={<HandCoins />}
                tom="destructive"
                titulo={`${formatBRL(totalAPagar)} a pagar ao higienizador`}
                descricao={`${aguardandoPagamento} lote(s) devolvido(s)`}
              />
            )}
          </ListaDeAcoes>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">Envios</h2>
          <nav aria-label="Situação dos envios" className="flex flex-wrap gap-2">
            {FILTROS.map((f) => {
              const ativo = (status ?? "") === f.value;
              return (
                <Button key={f.value} asChild size="sm" variant={ativo ? "default" : "outline"}>
                  <Link
                    href={f.value ? `/higienizacao?status=${f.value}` : "/higienizacao"}
                    aria-current={ativo ? "page" : undefined}
                  >
                    {f.label}
                  </Link>
                </Button>
              );
            })}
          </nav>

          {registros.length === 0 ? (
            <EmptyState
              icon={<Sparkles />}
              title="Nenhum envio registrado"
              description="Registre o envio de caixas para o higienizador."
              action={
                <Button asChild>
                  <Link href="/higienizacao/nova">
                    <Plus /> Novo envio
                  </Link>
                </Button>
              }
            />
          ) : (
            <ListaDeAcoes>
              {registros.map((c) => {
                const aPagar = Number(c.valorAPagar) > 0;
                return (
                  <LinhaDeAcao
                    key={c.id}
                    href={`/higienizacao/${c.id}`}
                    titulo={
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{c.cleanerName}</span>
                        <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"}>
                          {CRATE_CLEANING_STATUS_LABELS[c.status]}
                        </Badge>
                      </span>
                    }
                    descricao={
                      <>
                        {formatDate(c.sentDate)} · {c.sentQty} enviada(s) · {c.returnedQty}{" "}
                        devolvida(s)
                        {c.perdidas > 0 ? ` · ${c.perdidas} perdida(s)` : ""}
                        {/* O que ainda falta neste lote, que é a razão de ele estar aberto. */}
                        {(c.caixasAReceber > 0 || aPagar) && (
                          <span className="block font-medium text-warning">
                            {c.caixasAReceber > 0 ? `faltam ${c.caixasAReceber} caixa(s)` : ""}
                            {c.caixasAReceber > 0 && aPagar ? " · " : ""}
                            {aPagar ? `a pagar ${formatBRL(c.valorAPagar)}` : ""}
                          </span>
                        )}
                      </>
                    }
                    complemento={
                      <span className="text-base font-bold">{formatBRL(c.totalAmount)}</span>
                    }
                  />
                );
              })}
            </ListaDeAcoes>
          )}
        </section>
      </div>
    </div>
  );
}
