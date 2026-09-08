import { desenharHistorico, type PontoParaDesenho } from "@/lib/cotacoes/grafico";
import { formatBRL, formatDateOnly } from "@/lib/format";
import { toNumber } from "@/lib/money";
import type { PontoDoHistorico } from "@/lib/services/cotacoes-historico.service";

/**
 * O preço deste produto ao longo do período, desenhado à mão em SVG.
 *
 * Sem biblioteca de gráfico, como `sales-chart.tsx`: o app é usado no celular
 * dentro do galpão, e uma lib pesaria mais que a tela toda. A geometria mora em
 * `lib/cotacoes/grafico.ts` porque é lá que ela é testada — inclusive a regra de
 * o eixo X ser proporcional ao tempo e não à posição na lista.
 */

// Coordenadas internas. O SVG é esticado pelo CSS até a largura disponível, e
// `vector-effect="non-scaling-stroke"` impede que o esticamento engorde o traço.
const LARGURA = 600;
const ALTURA = 160;

export function GraficoDeHistorico({
  pontos,
  unit,
}: {
  pontos: PontoDoHistorico[];
  unit: string;
}) {
  const desenho = desenharHistorico(
    pontos.map<PontoParaDesenho>((p) => ({
      t: p.quoteDate.getTime(),
      ref: toNumber(p.refPrice),
      min: p.minPrice === null ? null : toNumber(p.minPrice),
      max: p.maxPrice === null ? null : toNumber(p.maxPrice),
    })),
    LARGURA,
    ALTURA,
  );

  if (!desenho) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {pontos.length === 1
          ? "Só um boletim neste período — ainda não dá para desenhar tendência."
          : "Nenhum boletim neste período."}
      </p>
    );
  }

  const primeira = pontos[0].quoteDate;
  const ultima = pontos[pontos.length - 1].quoteDate;

  return (
    <div className="flex gap-2">
      <div className="flex w-16 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-muted-foreground">
        <span>{formatBRL(desenho.tetoDoEixo)}</span>
        <span>{formatBRL(desenho.pisoDoEixo)}</span>
      </div>

      <div className="min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${LARGURA} ${ALTURA}`}
          preserveAspectRatio="none"
          className="h-40 w-full"
          role="img"
          aria-label={`Preço por ${unit || "unidade"} de ${formatDateOnly(primeira)} a ${formatDateOnly(ultima)}, entre ${formatBRL(desenho.pisoDoEixo)} e ${formatBRL(desenho.tetoDoEixo)}.`}
        >
          {/*
            A faixa entre o mínimo e o máximo do dia, quando a fonte publica os
            três números. Ela é a informação que o preço de referência sozinho
            esconde: dois dias podem fechar na mesma média com amplitudes
            completamente diferentes, e é a amplitude que diz se havia margem de
            negociação no balcão.
          */}
          {desenho.faixa && (
            <polygon points={desenho.faixa} className="fill-primary/15" stroke="none" />
          )}
          <polyline
            points={desenho.linha}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{formatDateOnly(primeira)}</span>
          <span>{formatDateOnly(ultima)}</span>
        </div>
      </div>
    </div>
  );
}
