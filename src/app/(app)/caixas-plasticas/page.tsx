import Link from "next/link";
import {
  ChevronRight,
  PackagePlus,
  PackageX,
  Plus,
  Sparkles,
  Undo2,
} from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { CaixasService } from "@/lib/services/caixas.service";
import { formatDate } from "@/lib/format";
import { CRATE_MOVEMENT_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const BADGE_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  ENTRADA: "success",
  SAIDA: "warning",
  RETORNO: "secondary",
  QUEBRA: "destructive",
  SAIDA_HIGIENIZACAO: "warning",
  RETORNO_HIGIENIZACAO: "success",
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
  },
  {
    href: "/caixas-plasticas/novo?tipo=RETORNO",
    titulo: "Cliente devolveu",
    descricao: "Voltaram sujas para o estoque",
    icone: Undo2,
  },
  {
    href: "/caixas-plasticas/novo?tipo=QUEBRA",
    titulo: "Registrar perda",
    descricao: "Quebrou ou sumiu",
    icone: PackageX,
  },
] as const;

export default async function CaixasPlasticasPage() {
  const { tenantId } = await requireTenant();
  const [saldo, movimentos, porCliente] = await Promise.all([
    CaixasService.getSaldo(tenantId),
    CaixasService.list(tenantId),
    CaixasService.saldoPorCliente(tenantId),
  ]);

  // Maior devedor primeiro: é quem o operador vai cobrar antes.
  const clientes = [...porCliente.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <PageHeader
        title="Caixas plásticas"
        description="As caixas que saem com a mercadoria e voltam. Entrada, saída, devolução, higienização e perdas."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/caixas-plasticas/novo">
              <Plus /> Outro
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        {ACOES.map((a) => (
          <Link key={a.href} href={a.href}>
            <Card className="flex min-h-16 items-center gap-3 p-3 hover:bg-accent/40">
              <a.icone className="size-6 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block font-medium">{a.titulo}</span>
                <span className="block text-xs text-muted-foreground">{a.descricao}</span>
              </span>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard
          label="Limpas (prontas)"
          value={String(saldo.limpas)}
          tone="success"
          hint="Disponíveis para vender"
        />
        <StatCard
          label="Sujas"
          value={String(saldo.sujas)}
          hint="Aguardando higienização"
        />
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
        <div className="mb-4 flex flex-col gap-2">
          {saldo.sujas > 0 && (
            <Link href={`/higienizacao/nova?qtd=${saldo.sujas}`}>
              <Card className="flex items-center justify-between gap-3 border-warning/40 bg-warning/10 p-3 hover:bg-warning/15">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <Sparkles className="size-4 shrink-0 text-warning" />
                  <span>
                    <b>{saldo.sujas} caixa(s) suja(s)</b> — enviar para higienização
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Card>
            </Link>
          )}
          {saldo.emHigienizacao > 0 && (
            <Link href="/higienizacao">
              <Card className="flex items-center justify-between gap-3 p-3 hover:bg-accent/40">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <Sparkles className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <b>{saldo.emHigienizacao} caixa(s)</b> no higienizador — ver lotes
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Card>
            </Link>
          )}
        </div>
      )}

      {/* Fecha o ciclo saída → controle → devolução sem depender do fiado. */}
      {clientes.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Quem está com minhas caixas
          </h2>
          <div className="flex flex-col gap-2">
            {clientes.map(([nome, qtd]) => (
              <Card key={nome} className="flex items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {qtd} caixa(s) a devolver
                  </span>
                </span>
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <Link
                    href={`/caixas-plasticas/novo?tipo=RETORNO&qtd=${qtd}&cliente=${encodeURIComponent(nome)}`}
                  >
                    <Undo2 className="size-4" />
                    <span className="hidden sm:inline">Devolução</span>
                  </Link>
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Histórico</h2>

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
            <Card key={m.id} className="flex items-center justify-between p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={BADGE_VARIANT[m.type] ?? "secondary"}>
                    {CRATE_MOVEMENT_LABELS[m.type]}
                  </Badge>
                  <span className="truncate text-sm">
                    {m.customerName ?? m.supplierName ?? ""}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDate(m.movementDate)}
                  {m.brokenQty > 0 ? ` · ${m.brokenQty} quebrada(s) na chegada` : ""}
                  {m.notes ? ` · ${m.notes}` : ""}
                </span>
              </div>
              <span className="font-semibold tabular-nums">{m.quantity}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
