import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Package } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import {
  CotacoesHistoricoService,
  MESES_MINIMOS_PARA_MEDIA_MENSAL,
  PERIODOS_DE_HISTORICO,
  PERIODO_PADRAO,
  type PeriodoDeHistorico,
} from "@/lib/services/cotacoes-historico.service";
import { frescorDoBoletim, rotuloDeFrescor } from "@/lib/cotacoes/frescor";
import { rotuloDeVariacao, variacaoPercentual } from "@/lib/cotacoes/variacao";
import { formatBRL, formatDateOnly, valorExibivel } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { SeloDeVariacao } from "../../_components/selo-de-variacao";
import { GraficoDeHistorico } from "./_components/grafico-de-historico";
import { MediaPorMes } from "./_components/media-por-mes";
import { ComparativoDePracas } from "./_components/comparativo-de-pracas";

export const dynamic = "force-dynamic";

/** Só os períodos da lista entram; qualquer outro valor na URL cai no padrão. */
function periodoDaUrl(bruto: string | undefined): PeriodoDeHistorico {
  const n = Number(bruto);
  return (PERIODOS_DE_HISTORICO as readonly number[]).includes(n)
    ? (n as PeriodoDeHistorico)
    : PERIODO_PADRAO;
}

export default async function ProdutoCotacaoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ u?: string; dias?: string }>;
}) {
  const { id } = await params;
  const { u, dias } = await searchParams;
  const periodo = periodoDaUrl(dias);
  // A unidade vazia é válida no banco (`unit` é NOT NULL com default ""), então
  // a ausência do parâmetro é um valor, não um erro.
  const unit = u ?? "";

  const { tenantId } = await requireTenant();
  const h = await CotacoesHistoricoService.getHistorico(tenantId, {
    ceasaProductId: id,
    unit,
    periodo,
  });
  // Produto que não é cotado na praça desta empresa não existe para ela: 404, e
  // não uma tela vazia com cara de módulo quebrado.
  if (!h) notFound();

  const agora = new Date();
  const frescor = frescorDoBoletim(h.atual.quoteDate, agora, h.central.maxDiasSemBoletim);
  const rotuloFrescor = rotuloDeFrescor(frescor);

  /*
    Variação contra o boletim ANTERIOR, quando ele cai dentro da janela.

    Sai da própria série já carregada em vez de uma consulta nova — e é `null`
    quando a janela tem um ponto só, porque aí não há anterior nenhum para
    comparar, e não uma variação de zero.
  */
  const anterior = h.pontos.length >= 2 ? h.pontos[h.pontos.length - 2] : null;
  const vsAnterior = anterior
    ? variacaoPercentual(h.atual.refPrice, anterior.refPrice)
    : null;

  const linkDoPeriodo = (d: number) =>
    `/cotacoes/produto/${h.produto.id}?u=${encodeURIComponent(unit)}&dias=${d}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link href="/cotacoes">
            <ArrowLeft className="size-4" />
            Cotações
          </Link>
        </Button>
        <PageHeader
          title={h.produto.name}
          description={`${h.central.name} — ${h.central.city}/${h.central.uf} · preço por ${unit || "unidade não informada"}`}
        />
      </div>

      <Card className={cn("p-4", frescor.nivel === "defasado" && "border-warning/50 bg-warning/5")}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Preço de referência
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-3xl font-bold tabular-nums">
                {valorExibivel(formatBRL(h.atual.refPrice))}
              </span>
              <SeloDeVariacao variacao={vsAnterior} />
            </div>
            {h.atual.minPrice && h.atual.maxPrice && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                No dia, de {formatBRL(h.atual.minPrice)} a {formatBRL(h.atual.maxPrice)}
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-sm">Boletim de {formatDateOnly(h.atual.quoteDate)}</p>
            {rotuloFrescor && (
              <Badge
                variant={frescor.nivel === "defasado" ? "warning" : "secondary"}
                className="mt-1 gap-1"
              >
                {frescor.nivel === "defasado" && <AlertTriangle className="size-3" />}
                {rotuloFrescor}
              </Badge>
            )}
          </div>
        </div>

        {h.meuProduto && (
          <p className="mt-3 flex items-center gap-1.5 border-t pt-3 text-sm text-success">
            <Package className="size-4 shrink-0" aria-hidden="true" />
            Vinculado ao seu produto <strong>{h.meuProduto.name}</strong>
          </p>
        )}
      </Card>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Histórico de preço</h2>
          <div className="flex gap-1">
            {PERIODOS_DE_HISTORICO.map((d) => (
              <Button
                key={d}
                asChild
                size="sm"
                variant={periodo === d ? "default" : "outline"}
              >
                <Link href={linkDoPeriodo(d)} scroll={false}>
                  {d === 365 ? "1 ano" : `${d} dias`}
                </Link>
              </Button>
            ))}
          </div>
        </div>

        <Card className="p-4">
          <GraficoDeHistorico pontos={h.pontos} unit={unit} />

          {h.resumo && (
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
              <Numero rotulo="Mínimo" valor={formatBRL(h.resumo.minimo)} />
              <Numero rotulo="Máximo" valor={formatBRL(h.resumo.maximo)} />
              <Numero rotulo="Média" valor={formatBRL(h.resumo.media)} />
              <Numero
                rotulo="No período"
                valor={rotuloDeVariacao(h.resumo.variacaoNoPeriodo) ?? "—"}
              />
            </dl>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            {h.pontos.length === 1
              ? "1 boletim no período."
              : `${h.pontos.length} boletins no período.`}{" "}
            O histórico começa no dia em que passamos a receber o boletim desta praça.
          </p>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Média por mês</h2>
        <Card className="p-4">
          {h.mediaPorMes.length > 0 ? (
            <>
              <MediaPorMes dados={h.mediaPorMes} />
              {/*
                O aviso não é rodapé decorativo. Doze meses de dado é UM ciclo
                agrícola, e um ciclo não estabelece sazonalidade — mostra o que
                aconteceu no ano passado. Chamar isso de "sazonalidade" e deixar
                o comerciante comprar caminhão em cima disso seria o módulo
                afirmando mais do que mediu.
              */}
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Média dos boletins de cada mês nos últimos 12 meses. É um ciclo de
                colheita, não uma média histórica: serve para levantar a suspeita de
                safra e entressafra, não para fechar negócio sozinho. Passe o dedo
                sobre a barra para ver de quantos boletins ela veio.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ainda estamos juntando histórico deste produto — são {h.mesesComDado}{" "}
              {h.mesesComDado === 1 ? "mês" : "meses"} com boletim, e a média por mês
              aparece a partir de {MESES_MINIMOS_PARA_MEDIA_MENSAL}. Desenhar safra com
              menos que isso seria chutar com cara de gráfico.
            </p>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Preço em outras praças</h2>
        <Card className="p-4">
          <ComparativoDePracas pracas={h.comparativo} unit={unit} agora={agora} />
        </Card>
      </section>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}
