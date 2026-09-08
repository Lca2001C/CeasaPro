import { toNumber, type Numeric } from "@/lib/money";

/**
 * Quanto o preço mexeu de um boletim para o outro, e o desenho do minigráfico.
 *
 * Funções puras, sem import de React nem de Prisma — no molde de `frescor.ts` e
 * `nivelEstoque`. É a REGRA que se testa; o JSX que a usa é consequência.
 */

/**
 * Abaixo de quantos por cento a variação é lida como "sem mudança".
 *
 * Não é enfeite: o boletim publica centavos, e um produto de R$ 5,00 que anda
 * R$ 0,02 rende 0,4% — um número que a tela mostraria como "alta" com seta
 * verde. Nenhum comerciante muda o preço do balcão por dois centavos, e uma tela
 * que grita "subiu!" toda vez que a terceira casa decimal mexe ensina a ignorar
 * a seta — levando junto a alta de 18% que ela existe para mostrar.
 *
 * Meio por cento é o ponto onde o movimento vira dinheiro perceptível na caixa:
 * numa caixa de 20 kg a R$ 5,00/kg, 0,5% é R$ 0,50.
 */
export const LIMIAR_DE_ESTABILIDADE = 0.5;

export type DirecaoDaVariacao = "alta" | "baixa" | "estavel";

/**
 * Variação percentual entre dois boletins. `null` quando não dá para calcular.
 *
 * Devolve `null` — e não zero — quando falta o preço anterior ou ele é zero ou
 * negativo. Os dois casos são "não sei", e zero seria "não mudou": a tela
 * mostraria "0%" com ar de informação para um produto que estreou no boletim
 * hoje, e o comerciante concluiria que o preço está estável há tempos.
 */
export function variacaoPercentual(
  atual: Numeric | null | undefined,
  anterior: Numeric | null | undefined,
): number | null {
  if (atual === null || atual === undefined) return null;
  if (anterior === null || anterior === undefined) return null;
  const a = toNumber(atual);
  const b = toNumber(anterior);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Base zero ou negativa não tem variação percentual definida — dividir daria
  // Infinity, que viraria "∞%" na tela.
  if (b <= 0) return null;
  return ((a - b) / b) * 100;
}

export function direcaoDaVariacao(v: number | null): DirecaoDaVariacao | null {
  if (v === null) return null;
  if (Math.abs(v) < LIMIAR_DE_ESTABILIDADE) return "estavel";
  return v > 0 ? "alta" : "baixa";
}

/**
 * O texto do selo: "+3,2%", "−1,5%", "0%".
 *
 * Usa o sinal de menos tipográfico (U+2212) pelo mesmo motivo de
 * `valorExibivel`: o hífen-menos permite quebra de linha depois dele, e um sinal
 * órfão numa linha inverte a leitura de queda para alta.
 *
 * Dentro do limiar mostra "0%" cravado, e não o número real arredondado — um
 * "0,4%" arredondado para "0%" ao lado de uma seta de alta faria a tela parecer
 * quebrada.
 */
export function rotuloDeVariacao(v: number | null): string | null {
  if (v === null) return null;
  if (direcaoDaVariacao(v) === "estavel") return "0%";
  const n = Math.abs(v).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${v > 0 ? "+" : "−"}${n}%`;
}

/**
 * Os pontos do minigráfico, em coordenadas SVG, do mais antigo ao mais recente.
 *
 * Devolve string vazia quando não há o que desenhar (0 ou 1 ponto): uma linha de
 * um ponto só não é tendência nenhuma, e desenhar um traço reto sugeriria
 * estabilidade medida onde não há medida.
 *
 * Série constante (todo mundo no mesmo preço) desenha no MEIO da caixa, não na
 * base: encostar no chão pareceria queda a zero.
 */
export function trilhaDoMinigrafico(
  valores: number[],
  largura: number,
  altura: number,
): string {
  const pontos = valores.filter((v) => Number.isFinite(v));
  if (pontos.length < 2) return "";

  const min = Math.min(...pontos);
  const max = Math.max(...pontos);
  const amplitude = max - min;
  const passo = largura / (pontos.length - 1);

  return pontos
    .map((v, i) => {
      const x = i * passo;
      // Sem amplitude não há proporção a respeitar: fica na metade da altura.
      const y = amplitude === 0 ? altura / 2 : altura - ((v - min) / amplitude) * altura;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
