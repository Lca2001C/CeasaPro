import type { LinhaDeCotacao } from "@/lib/cotacoes/csv";

export type { LinhaDeCotacao };

/**
 * Desfecho de uma busca de boletim.
 *
 * TRÊS estados, e não dois, é a decisão que sustenta o alarme:
 *
 *  - `vazio: true` — a fonte respondeu certo e NÃO havia boletim naquele dia
 *    (sábado, domingo, feriado, publicação atrasada). Isso não é falha e não
 *    alerta ninguém.
 *  - `ok: true` com linhas — boletim recebido.
 *  - `ok: false` — erro de rede, HTTP ruim, erro do banco da fonte, ou HTML que
 *    o adaptador não reconheceu.
 *
 * Sem essa distinção o aviso dispararia todo fim de semana, seria ignorado em um
 * mês, e a falha de verdade passaria batida junto — o módulo morreria em
 * silêncio do mesmo jeito, só que com um alarme instalado dando a impressão
 * contrária.
 */
export interface ResultadoDaFonte {
  ok: boolean;
  vazio?: boolean;
  linhas: LinhaDeCotacao[];
  /**
   * Assinatura ESTRUTURAL da resposta — os campos que o parser depende, em
   * ordem. Quando muda em relação à última execução bem-sucedida, dispara aviso
   * MESMO com o parsing tendo dado certo: é a única camada que pega corrupção
   * silenciosa, do tipo "colunas trocadas, mínimo virou máximo".
   */
  fingerprint?: string;
  /** Data que a PRÓPRIA resposta diz ser (ISO). Serve para conferir que veio o dia pedido. */
  dataDaResposta?: string | null;
  httpStatus?: number;
  erro?: string;
}

export interface ParametrosDeBusca {
  /** O que identifica a central na fonte (vem de `CeasaCentral.sourceParams`). */
  sourceParams: unknown;
  /** Dia do boletim desejado. */
  data: Date;
}

/**
 * Uma fonte de boletim.
 *
 * A separação entre `buscar` (I/O) e `parse` (PURO) é a decisão central deste
 * arquivo. É ela que permite:
 *   - escrever e testar o parsing contra um arquivo salvo, sem rede;
 *   - manter a suíte determinística e rápida;
 *   - deixar registrado no repositório como a resposta da fonte realmente é.
 *
 * Contrato da casa: **nunca lança para o chamador**. Devolve `{ ok, ... }` e
 * quem chama decide — mesmo desenho de `sendEmail`.
 */
export interface FonteDeCotacao {
  readonly chave: string;
  buscar(p: ParametrosDeBusca): Promise<ResultadoDaFonte>;
  parse(corpo: string): ResultadoDaFonte;
}
