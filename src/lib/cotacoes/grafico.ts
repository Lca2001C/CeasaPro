/**
 * Geometria do gráfico de histórico de preço.
 *
 * Fica separada do JSX porque é ela que tem regra e é ela que se testa — mesmo
 * motivo de `frescor.ts` e `variacao.ts`. E porque o desenho tem duas decisões
 * que erram calado se ninguém as fixar num teste: o eixo do tempo e a moldura
 * vertical.
 */

export interface PontoParaDesenho {
  /** Instante do boletim, em milissegundos. */
  t: number;
  ref: number;
  /** Faixa do dia. `null` quando a fonte não publica mínimo/máximo. */
  min: number | null;
  max: number | null;
}

export interface DesenhoDoHistorico {
  /** Pontos da linha do preço de referência, em coordenadas SVG. */
  linha: string;
  /**
   * Polígono fechado entre o mínimo e o máximo do dia. String vazia quando a
   * fonte não publica faixa — a série nacional da CONAB, por exemplo.
   */
  faixa: string;
  /** Extremos do EIXO (já com folga), que é o que os rótulos precisam mostrar. */
  pisoDoEixo: number;
  tetoDoEixo: number;
}

/**
 * Folga vertical, em fração da amplitude.
 *
 * Sem ela o menor e o maior ponto da série encostam nas bordas da caixa e a
 * metade externa do traço fica cortada — e, pior, o gráfico sugere que o preço
 * bateu no limite de alguma coisa, quando o limite é só o desenho.
 */
const FOLGA = 0.08;

/**
 * Converte a série em coordenadas SVG. `null` com menos de dois pontos.
 *
 * **O eixo X é proporcional ao TEMPO, não ao índice.** Esta é a decisão que
 * justifica o módulo existir separado. Espaçar os pontos igualmente é o que
 * qualquer implementação rápida faz, e produz uma mentira específica: a praça
 * não publica todo dia — quatro das sete unidades de Minas publicam 2 a 3 vezes
 * por semana, e nenhuma publica em feriado — então um intervalo de 11 dias entre
 * dois boletins apareceria com a mesma largura de um intervalo de 1 dia. Uma
 * queda de 20% ao longo de duas semanas seria desenhada como um tombo de um dia
 * para o outro, e é exatamente sobre esse desenho que o comerciante decide
 * comprar caminhão.
 */
export function desenharHistorico(
  pontos: PontoParaDesenho[],
  largura: number,
  altura: number,
): DesenhoDoHistorico | null {
  const validos = pontos.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.ref));
  // Um ponto não é histórico. Desenhar um traço reto afirmaria estabilidade que
  // ninguém mediu.
  if (validos.length < 2) return null;

  const ordenados = [...validos].sort((a, b) => a.t - b.t);
  const t0 = ordenados[0].t;
  const t1 = ordenados[ordenados.length - 1].t;
  const duracao = t1 - t0;

  // A moldura vertical cobre a FAIXA do dia também, e não só a linha de
  // referência: senão o polígono do mínimo/máximo vazaria para fora da caixa.
  const valores: number[] = [];
  for (const p of ordenados) {
    valores.push(p.ref);
    if (p.min !== null && Number.isFinite(p.min)) valores.push(p.min);
    if (p.max !== null && Number.isFinite(p.max)) valores.push(p.max);
  }
  const menor = Math.min(...valores);
  const maior = Math.max(...valores);
  const amplitude = maior - menor;
  // Série constante não tem amplitude para escalar: abre uma janela artificial
  // em volta do valor, e a linha sai no meio da caixa.
  const folga = amplitude === 0 ? Math.max(Math.abs(menor) * FOLGA, 0.5) : amplitude * FOLGA;
  const pisoDoEixo = menor - folga;
  const tetoDoEixo = maior + folga;
  const alcance = tetoDoEixo - pisoDoEixo;

  const x = (t: number) => (duracao === 0 ? 0 : ((t - t0) / duracao) * largura);
  const y = (v: number) => altura - ((v - pisoDoEixo) / alcance) * altura;
  const par = (t: number, v: number) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`;

  const linha = ordenados.map((p) => par(p.t, p.ref)).join(" ");

  // A faixa só existe se TODOS os pontos tiverem mínimo e máximo. Um polígono
  // com buracos costurados por interpolação inventaria amplitude nos dias em
  // que a fonte não publicou faixa nenhuma.
  const comFaixa = ordenados.every(
    (p) => p.min !== null && p.max !== null && Number.isFinite(p.min) && Number.isFinite(p.max),
  );
  const faixa = comFaixa
    ? [
        ...ordenados.map((p) => par(p.t, p.max!)),
        ...[...ordenados].reverse().map((p) => par(p.t, p.min!)),
      ].join(" ")
    : "";

  return { linha, faixa, pisoDoEixo, tetoDoEixo };
}
