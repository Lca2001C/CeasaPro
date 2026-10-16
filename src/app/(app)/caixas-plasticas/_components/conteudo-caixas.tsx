import Link from "next/link";
import { PackagePlus, PackageX, Plus, Sparkles, Undo2 } from "lucide-react";
import { CaixasService } from "@/lib/services/caixas.service";
import { formatDate } from "@/lib/format";
import { CRATE_MOVEMENT_LABELS } from "@/lib/labels";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListaDeAcoes, LinhaDeAcao } from "@/components/ui/linha-de-acao";

const BADGE_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  ENTRADA: "success",
  SAIDA: "warning",
  RETORNO: "secondary",
  QUEBRA: "destructive",
  SAIDA_HIGIENIZACAO: "warning",
  RETORNO_HIGIENIZACAO: "success",
  ESTORNO_SAIDA: "secondary",
};

/**
 * Atalhos por SITUAÇÃO, não por tipo de lançamento.
 *
 * O formulário único com dropdown ("Entrada, Saída, Retorno, Quebra, Saída
 * higienização…") é vocabulário de contabilidade. Quem está no balcão pensa
 * "chegou mercadoria", "o cliente trouxe as caixas de volta", "quebrou uma".
 * Cada atalho abre o mesmo formulário já na situação certa.
 */
const ACOES = [
  {
    href: "/caixas-plasticas/novo?tipo=ENTRADA",
    titulo: "Recebi caixas",
    descricao: "Chegou mercadoria ou comprei caixas",
    icone: PackagePlus,
    tom: "primary",
  },
  {
    href: "/caixas-plasticas/novo?tipo=RETORNO",
    titulo: "Cliente devolveu",
    descricao: "Voltaram sujas para o estoque",
    icone: Undo2,
    tom: "info",
  },
  {
    href: "/caixas-plasticas/novo?tipo=QUEBRA",
    titulo: "Registrar perda",
    descricao: "Quebrou ou sumiu",
    icone: PackageX,
    tom: "destructive",
  },
] as const;

/** A aba "Caixas plásticas": as caixas que saem com a mercadoria e voltam. */
export async function ConteudoCaixas({ tenantId }: { tenantId: string }) {
  const [saldo, movimentos, porCliente] = await Promise.all([
    CaixasService.getSaldo(tenantId),
    CaixasService.list(tenantId),
    CaixasService.saldoPorCliente(tenantId),
  ]);

  // Maior devedor primeiro: é quem o operador vai cobrar antes.
  const clientes = [...porCliente.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-5">
      <ListaDeAcoes titulo="O que aconteceu?">
        {ACOES.map((a) => (
          <LinhaDeAcao
            key={a.href}
            href={a.href}
            icone={<a.icone />}
            tom={a.tom}
            titulo={a.titulo}
            descricao={a.descricao}
          />
        ))}
        <LinhaDeAcao
          href="/caixas-plasticas/novo"
          icone={<Plus />}
          tom="neutro"
          titulo="Outra movimentação"
          descricao="Saída para cliente ou outro lançamento"
        />
      </ListaDeAcoes>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Limpas (prontas)"
          value={String(saldo.limpas)}
          tone="success"
          hint="Disponíveis para vender"
        />
        <StatCard label="Sujas" value={String(saldo.sujas)} hint="Aguardando higienização" />
        <StatCard
          label="Em higienização"
          value={String(saldo.emHigienizacao)}
          hint="Com o higienizador"
        />
        <StatCard label="Com clientes" value={String(saldo.comClientes)} tone="warning" />
        <StatCard label="Perdidas/quebradas" value={String(saldo.perdidas)} tone="destructive" />
        <StatCard label="Total no estoque" value={String(saldo.vazias)} hint="Limpas + sujas" />
      </div>

      {/* Próximo passo, não só o número: um saldo sozinho não diz o que fazer. */}
      {(saldo.sujas > 0 || saldo.emHigienizacao > 0) && (
        <ListaDeAcoes titulo="Próximo passo">
          {saldo.sujas > 0 && (
            <LinhaDeAcao
              href={`/higienizacao/nova?qtd=${saldo.sujas}`}
              icone={<Sparkles />}
              tom="warning"
              titulo={`${saldo.sujas} caixa(s) suja(s)`}
              descricao="Enviar para higienização"
            />
          )}
          {saldo.emHigienizacao > 0 && (
            <LinhaDeAcao
              href="/higienizacao"
              icone={<Sparkles />}
              tom="neutro"
              titulo={`${saldo.emHigienizacao} caixa(s) no higienizador`}
              descricao="Ver lotes"
            />
          )}
        </ListaDeAcoes>
      )}

      {/* Fecha o ciclo saída → controle → devolução sem depender do fiado. */}
      {clientes.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
            Quem está com minhas caixas
          </h2>
          <div className="flex flex-col gap-2">
            {clientes.map(([nome, qtd]) => (
              <Card key={nome} className="flex items-center justify-between gap-2 p-4">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{nome}</span>
                  <span className="text-sm text-muted-foreground">
                    {qtd} caixa(s) a devolver
                  </span>
                </span>
                <Button asChild size="sm" variant="info" className="shrink-0">
                  <Link
                    href={`/caixas-plasticas/novo?tipo=RETORNO&qtd=${qtd}&cliente=${encodeURIComponent(nome)}`}
                  >
                    <Undo2 className="size-4" />
                    Devolução
                  </Link>
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">Histórico</h2>

        {movimentos.length === 0 ? (
          <EmptyState
            title="Nenhuma movimentação de caixas"
            description="Registre a primeira entrada de caixas plásticas."
            action={
              <Button asChild>
                <Link href="/caixas-plasticas/novo">
                  <Plus /> Movimentar caixas
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {movimentos.map((m) => (
              <Card key={m.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={BADGE_VARIANT[m.type] ?? "secondary"}>
                      {CRATE_MOVEMENT_LABELS[m.type]}
                    </Badge>
                    <span className="truncate text-sm">
                      {m.customerName ?? m.supplierName ?? ""}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {formatDate(m.movementDate)}
                    {m.brokenQty > 0 ? ` · ${m.brokenQty} quebrada(s) na chegada` : ""}
                    {m.notes ? ` · ${m.notes}` : ""}
                  </span>
                </div>
                <span className="text-lg font-bold tabular-nums">{m.quantity}</span>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
