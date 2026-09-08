import { AlertTriangle, MapPin } from "lucide-react";
import { frescorDoBoletim } from "@/lib/cotacoes/frescor";
import { direcaoDaVariacao, rotuloDeVariacao, variacaoPercentual } from "@/lib/cotacoes/variacao";
import { formatBRL, formatDateOnly } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import type { PracaComparada } from "@/lib/services/cotacoes-historico.service";

/**
 * O mesmo produto, na mesma embalagem, em cada praça que o cota.
 *
 * Ordenado do mais barato para o mais caro, com a praça da própria empresa
 * marcada, para responder à pergunta que motiva a tela: "estou comprando caro?".
 *
 * **A data de cada praça aparece em toda linha, e as defasadas são marcadas.**
 * Sem isso o comparativo mente por omissão, e de um jeito difícil de perceber:
 * as praças publicam em dias diferentes, e várias do catálogo dependem de envio
 * manual. Alinhar o preço de hoje de Contagem com o preço de 40 dias atrás de
 * outra praça na mesma coluna faz a diferença parecer geografia quando é
 * calendário — e manda o comerciante atravessar o estado atrás de uma pechincha
 * que não existe mais.
 *
 * O limiar de defasagem é o DA PRAÇA (`maxDiasSemBoletim`), não um número fixo:
 * quem publica duas vezes por semana não está atrasado no terceiro dia.
 */
export function ComparativoDePracas({
  pracas,
  unit,
  agora,
}: {
  pracas: PracaComparada[];
  unit: string;
  agora: Date;
}) {
  const minha = pracas.find((p) => p.ehMinha) ?? null;

  if (pracas.length <= 1) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma outra praça do catálogo publica este produto em {unit || "esta unidade"}.
        A comparação aparece assim que uma segunda praça trouxer a mesma embalagem.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {pracas.map((p) => {
        const frescor = frescorDoBoletim(p.quoteDate, agora, p.maxDiasSemBoletim);
        const defasada = frescor.nivel === "defasado";
        // Diferença contra a praça da empresa — que é a referência dela, não a
        // mais barata da lista.
        const diferenca =
          minha && !p.ehMinha ? variacaoPercentual(p.refPrice, minha.refPrice) : null;
        const rotulo = rotuloDeVariacao(diferenca);

        return (
          <div
            key={p.centralCode}
            className={cn(
              "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border p-2",
              p.ehMinha && "border-primary/50 bg-accent/40",
              defasada && "opacity-70",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate text-sm font-medium">
                {p.ehMinha && <MapPin className="size-3 shrink-0 text-primary" aria-hidden="true" />}
                {p.name}
                {p.ehMinha && (
                  <span className="shrink-0 text-xs font-normal text-primary">(sua praça)</span>
                )}
              </p>
              <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                <span>
                  {p.city}/{p.uf}
                </span>
                <span aria-hidden="true">·</span>
                <span>boletim de {formatDateOnly(p.quoteDate)}</span>
                {defasada && (
                  <Badge variant="warning" className="gap-1 px-1.5 py-0">
                    <AlertTriangle className="size-2.5" aria-hidden="true" />
                    {frescor.dias} dias
                  </Badge>
                )}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">{formatBRL(p.refPrice)}</p>
              {rotulo && (
                <p
                  className={cn(
                    "text-[11px] tabular-nums",
                    // Pela DIREÇÃO, não pelo sinal do número: uma diferença de
                    // 0,2% sai como "0%" no rótulo, e pintá-la de vermelho pelo
                    // sinal faria a tela contradizer o próprio texto.
                    direcaoDaVariacao(diferenca) === "alta" && "text-destructive",
                    direcaoDaVariacao(diferenca) === "baixa" && "text-success",
                    direcaoDaVariacao(diferenca) === "estavel" && "text-muted-foreground",
                  )}
                >
                  {rotulo} vs. sua praça
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
