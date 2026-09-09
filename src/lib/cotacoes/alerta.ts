import { toNumber, type Numeric } from "@/lib/money";
import { variacaoPercentual } from "./variacao";

/**
 * Quando um alerta de flutuação deve virar aviso.
 *
 * Função pura, no molde de `frescor.ts` e `variacao.ts`: é a REGRA que se testa,
 * e ela precisa ser testável sem banco, porque cada linha aqui é uma decisão
 * sobre quando incomodar alguém — e incomodar à toa é o único jeito de um
 * alarme deixar de funcionar.
 */

export type MotivoDoAlerta = "alta" | "baixa" | "acima_do_teto" | "abaixo_do_piso";

export interface AlertaConfigurado {
  /** De quantos por cento, para cima ou para baixo, o movimento merece aviso. */
  variacaoMinima: Numeric;
  /** Avisar quando o preço PASSAR deste valor (está caro para comprar). */
  precoTeto: Numeric | null;
  /** Avisar quando o preço CAIR abaixo deste valor (é hora de comprar). */
  precoPiso: Numeric | null;
}

export interface PrecoObservado {
  refPrice: Numeric | null;
  /** Preço do boletim ANTERIOR. `null` quando o item estreou. */
  anterior: Numeric | null;
}

export interface Disparo {
  motivos: MotivoDoAlerta[];
  /** Variação percentual apurada. `null` quando não havia com o que comparar. */
  variacao: number | null;
}

/**
 * Piso do limiar que a tela aceita, em por cento.
 *
 * Abaixo de meio por cento o "movimento" é o arredondamento de centavos do
 * próprio boletim — a mesma fronteira que `LIMIAR_DE_ESTABILIDADE` usa para não
 * pintar seta de alta em dois centavos. Deixar alguém configurar 0,1% seria
 * vender um alerta que toca todo dia por ruído.
 */
export const VARIACAO_MINIMA_ACEITA = 0.5;

/** Teto do limiar. Acima disto o alerta nunca tocaria, e seria um botão morto. */
export const VARIACAO_MAXIMA_ACEITA = 200;

/** Sugestão inicial da tela: movimento que já muda a conta do dia. */
export const VARIACAO_SUGERIDA = 10;

/**
 * Avalia UM alerta contra o preço observado.
 *
 * Devolve todos os motivos que se aplicam, e não só o primeiro: um produto pode
 * ter subido 15% E passado do teto na mesma publicação, e as duas coisas dizem
 * coisas diferentes para quem vai comprar ("mexeu muito" e "chegou no limite
 * que você mesmo marcou").
 *
 * Lista vazia = não avisar.
 */
export function avaliarAlerta(config: AlertaConfigurado, preco: PrecoObservado): Disparo {
  const motivos: MotivoDoAlerta[] = [];
  const variacao = variacaoPercentual(preco.refPrice, preco.anterior);

  // Sem preço atual não há o que avaliar — nem variação, nem teto, nem piso.
  if (preco.refPrice === null || preco.refPrice === undefined) {
    return { motivos, variacao: null };
  }
  const atual = toNumber(preco.refPrice);
  if (!Number.isFinite(atual)) return { motivos, variacao: null };

  const limiar = Math.max(toNumber(config.variacaoMinima), VARIACAO_MINIMA_ACEITA);
  if (variacao !== null && Math.abs(variacao) >= limiar) {
    motivos.push(variacao > 0 ? "alta" : "baixa");
  }

  /*
    Teto e piso são independentes da variação, de propósito.

    Um produto que sobe 2% por semana durante um mês nunca dispara o limiar de
    variação e mesmo assim passa do teto — e é justamente esse o movimento que o
    teto existe para pegar: a subida lenta que ninguém percebe boletim a boletim.
  */
  if (config.precoTeto !== null && config.precoTeto !== undefined) {
    const teto = toNumber(config.precoTeto);
    if (Number.isFinite(teto) && teto > 0 && atual >= teto) motivos.push("acima_do_teto");
  }
  if (config.precoPiso !== null && config.precoPiso !== undefined) {
    const piso = toNumber(config.precoPiso);
    if (Number.isFinite(piso) && piso > 0 && atual <= piso) motivos.push("abaixo_do_piso");
  }

  return { motivos, variacao };
}

/**
 * O texto de UM disparo, para a linha do aviso e para o corpo da notificação.
 *
 * Diz o preço junto com o motivo. "Batata subiu 18%" sem o número obriga a
 * abrir o app para saber se 18% em cima de R$ 3,00 ou de R$ 30,00 — e quem está
 * dirigindo para o CEASA às 4 da manhã não vai abrir.
 */
export function frase(
  nome: string,
  motivos: MotivoDoAlerta[],
  variacao: number | null,
  precoFormatado: string,
): string {
  const pct = variacao === null ? "" : `${Math.abs(variacao).toFixed(0)}%`;
  if (motivos.includes("alta")) return `${nome} subiu ${pct} (${precoFormatado})`;
  if (motivos.includes("baixa")) return `${nome} caiu ${pct} (${precoFormatado})`;
  if (motivos.includes("acima_do_teto")) return `${nome} passou do seu teto (${precoFormatado})`;
  if (motivos.includes("abaixo_do_piso")) return `${nome} está abaixo do seu piso (${precoFormatado})`;
  return `${nome} (${precoFormatado})`;
}
