import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, Minus, Plus, Tags } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { DespesasService, DESPESAS_POR_PAGINA } from "@/lib/services/despesas.service";
import { formatBRL, formatQty } from "@/lib/format";
import { addDaysTz, isoDateTz, startOfDayTz } from "@/lib/tz";
import { toDecimal } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { DespesaFiltro } from "@/lib/validations/despesa";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DespesaLinha, type DespesaLinhaDados } from "./_components/despesa-linha";
import { DespesasFiltros } from "./_components/despesas-filtros";
import { ReplicarMesButton } from "./_components/replicar-mes-button";

export const dynamic = "force-dynamic";

/**
 * Abas da lista.
 *
 * "Vencidas" existe porque é a pergunta real do dono do box — "o que está
 * atrasado?" — e era exatamente a que a tela não respondia: os avisos do
 * dashboard mandavam para a lista inteira e ele tinha de procurar.
 */
const FILTROS = [
  { value: "PENDENTE", label: "Pendentes" },
  { value: "VENCIDAS", label: "Vencidas" },
  { value: "PAGO", label: "Pagas" },
  { value: "TODAS", label: "Todas" },
] as const;

type Aba = (typeof FILTROS)[number]["value"];

interface Query {
  status?: string;
  vencidas?: string;
  q?: string;
  type?: string;
  categoria?: string;
  campo?: string;
  de?: string;
  ate?: string;
  proximos?: string;
  pagina?: string;
}

/** Variação percentual entre dois meses, para o comparativo. */
function variacao(atual: unknown, anterior: unknown): number | null {
  const a = toDecimal(anterior as number);
  // Sem base de comparação o certo é dizer "—", não inventar 100%.
  if (a.isZero()) return null;
  return toDecimal(atual as number).minus(a).dividedBy(a).times(100).toNumber();
}

function Comparativo({
  label,
  valor,
  variacaoPct,
}: {
  label: string;
  valor: string;
  variacaoPct: number | null;
}) {
  const subiu = variacaoPct !== null && variacaoPct > 0.5;
  const caiu = variacaoPct !== null && variacaoPct < -0.5;
  const Icone = subiu ? ArrowUp : caiu ? ArrowDown : Minus;
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="min-w-0 truncate text-sm text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="font-semibold tabular-nums">{valor}</span>
        <span
          className={cn(
            "flex items-center gap-0.5 text-xs tabular-nums",
            // Em despesa, subir é ruim: a cor segue o bolso, não o número.
            subiu ? "text-destructive" : caiu ? "text-success" : "text-muted-foreground",
          )}
        >
          <Icone className="size-3" />
          {variacaoPct === null ? "—" : `${formatQty(Math.abs(variacaoPct))}%`}
        </span>
      </span>
    </div>
  );
}

export default async function DespesasPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const sp = await searchParams;

  // `vencidas=1` na URL (usado pelos avisos e pelo push) equivale à aba Vencidas.
  const aba: Aba =
    sp.vencidas === "1"
      ? "VENCIDAS"
      : FILTROS.some((f) => f.value === sp.status)
        ? (sp.status as Aba)
        : "PENDENTE";
  const pagina = Math.max(1, Number(sp.pagina) || 1);

  const { tenantId } = await requireTenant();
  const agora = new Date();

  // "Vence nos próximos N dias": atalho vindo dos avisos, traduzido em período.
  const proximosDias = Number(sp.proximos) || 0;
  const janelaProximos =
    proximosDias > 0
      ? { de: isoDateTz(startOfDayTz(agora)), ate: isoDateTz(addDaysTz(agora, proximosDias)) }
      : null;

  const campoData =
    sp.campo === "paidDate" || sp.campo === "createdAt" || sp.campo === "dueDate"
      ? sp.campo
      : janelaProximos
        ? ("dueDate" as const)
        : undefined;

  const filtro: DespesaFiltro = {
    status: aba === "TODAS" || aba === "VENCIDAS" ? undefined : aba,
    vencidas: aba === "VENCIDAS" ? true : undefined,
    q: sp.q?.trim() || undefined,
    type: sp.type === "FIXA" || sp.type === "VARIAVEL" ? sp.type : undefined,
    categoryId: sp.categoria || undefined,
    dateField: campoData,
    from: janelaProximos?.de ?? sp.de ?? undefined,
    to: janelaProximos?.ate ?? sp.ate ?? undefined,
  };

  const skip = (pagina - 1) * DESPESAS_POR_PAGINA;

  // Filtro, ordem, limite e totais são resolvidos no banco. A tela carregava
  // TODAS as despesas para filtrar e somar em JS: ~278 ms com 2 anos de
  // histórico, crescendo sem teto.
  const [despesas, total, resumo, categorias] = await Promise.all([
    DespesasService.list(tenantId, { ...filtro, skip }),
    DespesasService.count(tenantId, filtro),
    DespesasService.resumoMes(tenantId, undefined, agora),
    DespesasService.listCategories(tenantId),
  ]);

  const comFiltros = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    return `/despesas?${q.toString()}`;
  };

  const ultimaPagina = Math.max(1, Math.ceil(total / DESPESAS_POR_PAGINA));
  // URL pedindo pagina inexistente (editada a mao, ou a lista encurtou): manda
  // para a ultima valida, em vez de mostrar "nenhuma despesa cadastrada" — que
  // seria mentira.
  if (pagina > ultimaPagina && total > 0) {
    redirect(comFiltros({ pagina: String(ultimaPagina) }));
  }

  function linkAba(v: Aba): string {
    // Busca e filtros extras sobrevivem à troca de aba — trocar de aba não é
    // "começar de novo". O que muda é só o recorte de situação.
    return comFiltros({
      status: v === "VENCIDAS" ? undefined : v,
      vencidas: v === "VENCIDAS" ? "1" : undefined,
      proximos: undefined,
      pagina: "1",
    });
  }

  const hoje = startOfDayTz(agora);
  const vencida = (d: (typeof despesas)[number]) =>
    d.status !== "PAGO" && d.dueDate !== null && d.dueDate < hoje;

  const linhas: DespesaLinhaDados[] = despesas.map((d) => ({
    id: d.id,
    description: d.description,
    amount: d.amount.toString(),
    type: d.type,
    status: d.status,
    paymentMethod: d.paymentMethod,
    recurring: d.recurring,
    categoryName: d.category?.name ?? null,
    dueDate: d.dueDate?.toISOString() ?? null,
    paidDate: d.paidDate?.toISOString() ?? null,
    vencida: vencida(d),
  }));

  return (
    <div>
      <PageHeader
        title="Despesas"
        description="Controle suas contas fixas e variáveis."
        action={
          <Button asChild size="sm">
            <Link href="/despesas/nova">
              <Plus /> Nova
            </Link>
          </Button>
        }
      />

      {/*
        Cards do MÊS, e não do histórico.
        Antes eles somavam todas as despesas de todos os tempos enquanto a lista
        embaixo mostrava um filtro — o número do topo nunca fechava com o de
        baixo. Agora cada card diz de qual data ele fala.
      */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard
          label="A pagar no mês"
          value={formatBRL(resumo.aPagar)}
          hint={`${resumo.aPagarCount} conta(s) pendente(s)`}
          tone="warning"
        />
        <StatCard
          label="Já paguei no mês"
          value={formatBRL(resumo.pagas)}
          hint={`${resumo.pagasCount} conta(s) quitada(s)`}
          tone="success"
        />
        <StatCard
          label="Vencidas"
          value={formatBRL(resumo.vencidas)}
          hint={`${resumo.vencidasCount} conta(s) atrasada(s)`}
          tone={resumo.vencidasCount > 0 ? "destructive" : "default"}
        />
      </div>

      {/* "Estou gastando mais que mês passado?" é a pergunta que vem logo depois
          de olhar os totais. */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-semibold">
              Contas de {resumo.referencia} vs. mês anterior
            </span>
            <Button asChild variant="ghost" size="sm" className="shrink-0">
              <Link href="/despesas/categorias">
                <Tags className="size-4" /> Categorias
              </Link>
            </Button>
          </div>
          <div className="divide-y">
            <Comparativo
              label="Fixas"
              valor={formatBRL(resumo.fixas)}
              variacaoPct={variacao(resumo.fixas, resumo.fixasMesAnterior)}
            />
            <Comparativo
              label="Variáveis"
              valor={formatBRL(resumo.variaveis)}
              variacaoPct={variacao(resumo.variaveis, resumo.variaveisMesAnterior)}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            As contas do mês consumiram{" "}
            <b className="tabular-nums">{formatQty(resumo.percentualDoFaturamento)}%</b> do que
            você vendeu ({formatBRL(resumo.faturamento)}).
          </p>
          <div className="mt-3">
            <ReplicarMesButton mesOrigem={resumo.referencia} />
          </div>
        </CardContent>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant={aba === f.value ? "default" : "outline"}
          >
            <Link href={linkAba(f.value)}>{f.label}</Link>
          </Button>
        ))}
      </div>

      <DespesasFiltros
        atuais={{
          status: aba === "VENCIDAS" ? "PENDENTE" : aba,
          q: sp.q ?? "",
          type: sp.type ?? "",
          categoryId: sp.categoria ?? "",
          dateField: sp.campo ?? "dueDate",
          from: sp.de ?? "",
          to: sp.ate ?? "",
        }}
        categorias={categorias.map((c) => ({ id: c.id, name: c.name }))}
      />

      {linhas.length === 0 ? (
        <EmptyState
          title={
            aba === "PAGO"
              ? "Nenhuma despesa paga"
              : aba === "VENCIDAS"
                ? "Nenhuma conta atrasada"
                : aba === "PENDENTE"
                  ? "Nenhuma conta pendente"
                  : "Nenhuma despesa cadastrada"
          }
          description={
            aba === "VENCIDAS"
              ? "Tudo em dia por aqui."
              : "Toque em Nova para lançar sua primeira despesa."
          }
          action={
            <Button asChild variant="outline">
              <Link href="/despesas/nova?duplicar=ultima">
                <Plus /> Nova igual à última
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {linhas.map((d) => (
            <DespesaLinha key={d.id} d={d} />
          ))}
        </div>
      )}

      {ultimaPagina > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          {pagina > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={comFiltros({ pagina: String(pagina - 1) })}>Anterior</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">
            Página {pagina} de {ultimaPagina} · {total} despesa{total === 1 ? "" : "s"}
          </span>
          {pagina < ultimaPagina ? (
            <Button asChild variant="outline" size="sm">
              <Link href={comFiltros({ pagina: String(pagina + 1) })}>Próxima</Link>
            </Button>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
