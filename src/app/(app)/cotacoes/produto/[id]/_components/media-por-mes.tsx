import { formatBRL } from "@/lib/format";
import { variacaoPercentual } from "@/lib/cotacoes/variacao";
import { toNumber } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { MediaDoMes } from "@/lib/services/cotacoes-historico.service";

/**
 * A média do produto em cada mês do calendário, nos últimos 12 meses.
 *
 * É a leitura de safra e entressafra: o comerciante olha em que meses o produto
 * historicamente custa menos e planeja compra e negociação com fornecedor.
 *
 * Duas honestidades embutidas, e nenhuma é opcional:
 *
 * 1. **Mês sem boletim fica VAZIO, não zerado.** Uma barra de altura zero em
 *    julho leria como "custou nada em julho" — e num gráfico de safra isso é
 *    exatamente a conclusão errada, no mês em que o produto some do mercado
 *    porque acabou a colheita. Ausência de dado e preço baixo são coisas
 *    opostas, e a tela precisa distingui-las.
 * 2. **Cada barra diz de quantos boletins veio.** Uma média de 22 boletins e uma
 *    média de 1 desenham a mesma barra, e só uma delas significa alguma coisa.
 */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function MediaPorMes({ dados }: { dados: MediaDoMes[] }) {
  const porMes = new Map(dados.map((d) => [d.mes, d]));
  const valores = dados.map((d) => toNumber(d.media));
  const maior = Math.max(...valores);
  const menor = Math.min(...valores);
  // A barra mais barata do ano é a informação que a pessoa veio buscar.
  const maisBarato = dados.find((d) => toNumber(d.media) === menor)?.mes ?? null;
  const maisCaro = dados.find((d) => toNumber(d.media) === maior)?.mes ?? null;
  /*
    A distância entre os dois extremos — sem o sinal de `rotuloDeVariacao`.

    Aquele "+" existe para variação NO TEMPO ("subiu 3%"), e aqui não há tempo
    nenhum: é a distância entre o mês mais barato e o mais caro do ano. "Diferença
    de +151%" sugeria que algo tinha subido 151%, que é outra afirmação.
  */
  const espalhamento = variacaoPercentual(maior, menor);
  const diferenca =
    espalhamento === null
      ? null
      : `${espalhamento.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;

  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {MESES.map((rotulo, i) => {
          const mes = i + 1;
          const d = porMes.get(mes);
          if (!d) {
            return (
              <div key={rotulo} className="flex-1" title={`${rotulo}: sem boletim`}>
                {/* Traço fino no chão: marca que o mês existe e não tem dado. */}
                <div className="h-[2px] w-full rounded-sm bg-muted" />
              </div>
            );
          }
          const v = toNumber(d.media);
          // Proporção sobre o maior do ano, com piso visível: uma barra de 1px
          // não é legível nem tocável.
          const altura = maior > 0 ? Math.max((v / maior) * 100, 4) : 4;
          return (
            <div
              key={rotulo}
              className={cn(
                "flex-1 rounded-t-sm transition-colors",
                mes === maisBarato ? "bg-success/70" : "bg-primary/60",
              )}
              style={{ height: `${altura}%` }}
              title={`${rotulo}: ${formatBRL(d.media)} — média de ${d.amostras} ${d.amostras === 1 ? "boletim" : "boletins"}`}
            />
          );
        })}
      </div>

      <div className="mt-1 flex gap-1 text-center text-[10px] text-muted-foreground">
        {MESES.map((rotulo, i) => (
          <span
            key={rotulo}
            className={cn("flex-1", i + 1 === maisBarato && "font-semibold text-success")}
          >
            {rotulo}
          </span>
        ))}
      </div>

      {/*
        A resposta em texto, porque só o desenho não a dá.

        As barras começam no ZERO, e isso não é negociável: barra truncada é o
        jeito clássico de transformar 8% de diferença em "o dobro". Mas a
        consequência é que uma faixa estreita — R$ 3,00 a R$ 3,33 no ano — vira
        doze barras visualmente idênticas, e a pessoa sai da tela sem a
        informação que veio buscar.

        Então o número vai escrito. Assim a leitura fica correta nas duas
        direções: o desenho não exagera a diferença, e o texto não a esconde.
      */}
      {maisBarato !== null && maisCaro !== null && maisBarato !== maisCaro && (
        <p className="mt-3 text-xs">
          Mais barato em{" "}
          <strong className="text-success">
            {MESES[maisBarato - 1]} ({formatBRL(porMes.get(maisBarato)!.media)})
          </strong>
          ; mais caro em{" "}
          <strong>
            {MESES[maisCaro - 1]} ({formatBRL(porMes.get(maisCaro)!.media)})
          </strong>
          {diferenca ? ` — uma diferença de ${diferenca} entre os dois.` : "."}
        </p>
      )}
    </div>
  );
}
