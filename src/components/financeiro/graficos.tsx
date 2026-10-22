import type { ReactNode } from "react";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Card, CardContent } from "@/components/ui/card";
import { BotaoComoECalculado } from "./explicacao";
import type { Explicacao } from "@/lib/financeiro/explicacoes";

/**
 * Gráficos do Financeiro do Início.
 *
 * Feitos em HTML/CSS, renderizados no servidor: sem biblioteca de gráfico (que
 * pesaria no 4G do galpão e precisaria de JS para desenhar) e sem nada a
 * hidratar. Regras que todos seguem:
 *
 * - **Cor pelo papel, em ordem fixa:** Vendas = `viz-1` (azul), Compras =
 *   `viz-2` (laranja), Contas = `viz-3` (verde-água) — a mesma série tem a
 *   mesma cor em todo gráfico. Tokens em `globals.css`, validados para
 *   daltonismo nos dois temas.
 * - **Nunca só cor:** toda série tem legenda e o valor escrito; o texto usa a
 *   cor de texto, não a da série.
 * - **Dica ao tocar/passar o mouse:** cada barra é focável e mostra o valor
 *   exato. No celular, tocar foca a barra e a dica aparece.
 * - **Tabela:** cada gráfico abre os números em "Ver em tabela".
 */

/** Cor de cada série, por papel. */
export const COR_SERIE = {
  vendas: "bg-viz-1",
  compras: "bg-viz-2",
  contas: "bg-viz-3",
} as const;

export function CartaoGrafico({
  titulo,
  subtitulo,
  destaque,
  children,
  tabela,
  explicacao,
}: {
  titulo: string;
  subtitulo?: string;
  destaque?: ReactNode;
  children: ReactNode;
  /** "Como é calculado", num botão discreto no cabeçalho. */
  explicacao?: Explicacao;
  /** Linhas da visão em tabela: [rótulo, ...valores]. */
  tabela?: { colunas: string[]; linhas: (string | number)[][] };
}) {
  return (
    // `min-w-0`: dentro de grid, o cartão não pode crescer além da coluna
    // por causa da largura mínima das barras (era o que vazava a 320px).
    <Card className="min-w-0">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{titulo}</h3>
            {subtitulo && <p className="text-xs text-muted-foreground">{subtitulo}</p>}
          </div>
          {(destaque || explicacao) && (
            <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
              {destaque && (
                <div className="whitespace-nowrap text-lg font-bold tabular-nums">{destaque}</div>
              )}
              {explicacao && <BotaoComoECalculado explicacao={explicacao} />}
            </div>
          )}
        </div>
        {children}
        {tabela && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              Ver em tabela
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    {tabela.colunas.map((c, i) => (
                      <th key={c} className={cn("py-1 pr-3 font-medium", i > 0 && "text-right")}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabela.linhas.map((l, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {l.map((v, j) => (
                        <td key={j} className={cn("whitespace-nowrap py-1 pr-3", j > 0 && "text-right")}>
                          {typeof v === "number" ? formatBRL(v) : v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export function Legenda({ itens }: { itens: { cor: string; rotulo: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex items-center gap-1.5">
          <span className={cn("inline-block size-2.5 rounded-sm", i.cor)} aria-hidden />
          {i.rotulo}
        </li>
      ))}
    </ul>
  );
}

/** Dica do valor exato, mostrada no hover e no foco (toque) da barra. */
function Dica({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block group-focus-visible:block group-focus:block"
    >
      {children}
    </span>
  );
}

/** Escala "redonda" para o eixo: 0, metade e o topo. */
function topoDaEscala(max: number): number {
  if (max <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= max) return m * base;
  return 10 * base;
}

const compacto = (v: number) =>
  v >= 1000
    ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
    : formatBRL(v);

function Grade({ topo }: { topo: number }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {[1, 0.5, 0].map((f) => (
        <div
          key={f}
          className="absolute inset-x-0 border-t border-dashed border-border"
          style={{ bottom: `${f * 100}%` }}
        >
          <span className="absolute right-full top-0 mr-1.5 -translate-y-1/2 whitespace-nowrap text-[10px] leading-none text-muted-foreground">
            {compacto(topo * f)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Colunas no tempo, uma série (vendas por dia). Rótulo do eixo de dias a cada
 * poucos dias, para não amontoar no celular.
 */
export function ColunasPorDia({
  dados,
  serie = "vendas",
  rotuloSerie = "Vendas",
}: {
  dados: { date: string; total: number }[];
  serie?: keyof typeof COR_SERIE;
  rotuloSerie?: string;
}) {
  const topo = topoDaEscala(Math.max(0, ...dados.map((d) => d.total)));
  const dia = (iso: string) =>
    new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    });
  const passo = Math.max(1, Math.ceil(dados.length / 6));
  return (
    <div>
      <div className="relative h-40 pl-14">
        <div className="absolute inset-y-0 left-14 right-0">
          <Grade topo={topo} />
        </div>
        <div className="relative flex h-full items-end gap-px sm:gap-0.5">
          {dados.map((d) => {
            const pct = (d.total / topo) * 100;
            return (
              <button
                type="button"
                key={d.date}
                aria-label={`${rotuloSerie} em ${dia(d.date)}: ${formatBRL(d.total)}`}
                className="group relative flex h-full min-w-0 p-0 flex-1 cursor-default items-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "block w-full rounded-t-[4px] transition-opacity group-hover:opacity-80 group-focus:opacity-80",
                    COR_SERIE[serie],
                    d.total === 0 && "opacity-0",
                  )}
                  style={{ height: `${d.total > 0 ? Math.max(pct, 1.5) : 0}%` }}
                />
                <Dica>
                  {dia(d.date)} · <b>{formatBRL(d.total)}</b>
                </Dica>
              </button>
            );
          })}
        </div>
      </div>
      {/* Rótulos do eixo: o da ponta esquerda alinha à esquerda e o da direita
          à direita, para o texto (mais largo que a barra) não sair do cartão. */}
      <div className="mt-1 flex gap-px pl-14 text-[10px] text-muted-foreground sm:gap-0.5" aria-hidden>
        {dados.map((d, i) => {
          const ultimo = i === dados.length - 1;
          const mostrar = (i % passo === 0 && i < dados.length - 2) || ultimo;
          return (
            <span
              key={d.date}
              className={cn(
                "flex min-w-0 flex-1 whitespace-nowrap",
                i === 0 ? "justify-start" : ultimo ? "justify-end" : "justify-center",
              )}
            >
              {mostrar ? dia(d.date) : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Colunas agrupadas por mês: Vendas, Compras e Contas lado a lado, uma
 * escala só (as três são reais — nada de segundo eixo).
 */
export function ColunasPorMes({
  meses,
}: {
  meses: { mes: string; vendas: number; compras: number; contas: number }[];
}) {
  const series = [
    { chave: "vendas", rotulo: "Vendas" },
    { chave: "compras", rotulo: "Compras" },
    { chave: "contas", rotulo: "Contas" },
  ] as const;
  const topo = topoDaEscala(Math.max(0, ...meses.flatMap((m) => [m.vendas, m.compras, m.contas])));
  return (
    <div className="flex flex-col gap-2">
      <Legenda itens={series.map((s) => ({ cor: COR_SERIE[s.chave], rotulo: s.rotulo }))} />
      <div className="relative h-48 pl-14">
        <div className="absolute inset-y-0 left-14 right-0">
          <Grade topo={topo} />
        </div>
        <div className="relative flex h-full items-end gap-3">
          {meses.map((m) => (
            <div key={m.mes} className="flex h-full flex-1 items-end justify-center gap-0.5">
              {series.map((s) => {
                const valor = m[s.chave];
                return (
                  <button
                    type="button"
                    key={s.chave}
                    aria-label={`${s.rotulo} em ${nomeDoMes(m.mes)}: ${formatBRL(valor)}`}
                    className="group relative flex h-full min-w-0 p-0 w-full max-w-6 cursor-default items-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        "block w-full rounded-t-[4px] transition-opacity group-hover:opacity-80 group-focus:opacity-80",
                        COR_SERIE[s.chave],
                      )}
                      style={{ height: `${valor > 0 ? Math.max((valor / topo) * 100, 1.5) : 0}%` }}
                    />
                    <Dica>
                      {s.rotulo} · {nomeDoMes(m.mes)} · <b>{formatBRL(valor)}</b>
                    </Dica>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3 pl-14 text-[11px] text-muted-foreground" aria-hidden>
        {meses.map((m) => (
          <span key={m.mes} className="flex-1 text-center">
            {nomeDoMes(m.mes)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a!, m! - 1, 15))
    .toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })
    .replace(".", "");
}

/**
 * Barras horizontais com o valor escrito — para "quanto de cada coisa"
 * (forma de pagamento, categoria de conta, o resultado do mês). Uma cor por
 * gráfico, ou uma por linha quando a linha é uma série conhecida.
 */
export function BarrasHorizontais({
  itens,
  cor = COR_SERIE.vendas,
  mostrarPercentual = true,
}: {
  itens: { rotulo: string; valor: number; cor?: string; prefixo?: string }[];
  cor?: string;
  mostrarPercentual?: boolean;
}) {
  const max = Math.max(1, ...itens.map((i) => Math.abs(i.valor)));
  const soma = itens.reduce((a, i) => a + Math.abs(i.valor), 0) || 1;
  return (
    <ul className="flex flex-col gap-2.5">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{i.rotulo}</span>
            <span className="shrink-0 font-semibold tabular-nums">
              {i.prefixo}
              {formatBRL(Math.abs(i.valor))}
              {mostrarPercentual && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {Math.round((Math.abs(i.valor) / soma) * 100)}%
                </span>
              )}
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-muted" aria-hidden>
            <div
              className={cn("h-full rounded-full", i.cor ?? cor)}
              style={{ width: `${Math.max((Math.abs(i.valor) / max) * 100, i.valor ? 1.5 : 0)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
