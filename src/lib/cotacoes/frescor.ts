import { civilParts } from "@/lib/tz";

/**
 * Quão velho está o boletim que a tela está mostrando.
 *
 * O usuário pediu "cotação em tempo real". Não existe: as centrais publicam um
 * boletim POR DIA, e o preço do momento é negociado no balcão, sem divulgação.
 * A escolha aqui, então, é entre esconder a idade do dado e mostrá-la. Esconder
 * seria mais bonito e faria o cliente repassar preço de três dias atrás achando
 * que era o de agora — que é o único jeito de este módulo causar prejuízo.
 *
 * Por isso a data do boletim aparece sempre, e a idade vira aviso quando cresce.
 *
 * Função pura, no molde de `nivelEstoque`: a regra é testável sozinha, e é ela
 * que se testa — não o JSX.
 */

/**
 * Padrão de "a partir de quantos dias o boletim é velho".
 *
 * É só o FALLBACK: cada central tem o seu (`CeasaCentral.maxDiasSemBoletim`),
 * porque a cadência varia muito. Medido contra a fonte real, em 8 dias úteis
 * seguidos: Grande BH e Grande Vitória publicam quase todo dia útil, mas Juiz de
 * Fora, Barbacena, Caratinga e Poços de Caldas publicam 2 a 3 vezes por semana.
 *
 * Um limiar único de 3 dias — que era o valor anterior — faria essas quatro
 * unidades ficarem permanentemente marcadas como defasadas na tela e alarmando o
 * super-admin toda semana. Um alarme que grita sempre é ignorado em um mês, e
 * leva junto o alarme da quebra de verdade, que é a única coisa que ele existe
 * para pegar.
 *
 * Sete dias cobre qualquer cadência semanal; quem publica todo dia recebe 3 no
 * banco.
 */
export const DIAS_ATE_DEFASAGEM = 7;

export type FrescorDoBoletim = "atual" | "atrasado" | "defasado" | "ausente";

export interface Frescor {
  nivel: FrescorDoBoletim;
  /** Dias inteiros entre a data do boletim e hoje. `null` quando não há boletim. */
  dias: number | null;
}

/**
 * Compara duas datas por DIA de calendário, não por instante.
 *
 * Duas assimetrias de propósito:
 *
 * - **O boletim é lido em UTC.** `quoteDate` vem de uma coluna `DATE`, que o
 *   driver entrega como meia-noite UTC — ler os campos civis brasileiros dela
 *   devolveria o dia ANTERIOR (21h do dia de antes).
 * - **O "agora" é lido no fuso do app.** O usuário está no Brasil, e o servidor
 *   roda em UTC: entre 21h e meia-noite o "hoje" em UTC já é amanhã, e o boletim
 *   publicado hoje de manhã apareceria como sendo de ontem. Foi exatamente o
 *   defeito que `src/lib/tz.ts` existe para evitar, e ele valia aqui também.
 */
function diasDeDiferenca(boletim: Date, agora: Date): number {
  const a = Date.UTC(boletim.getUTCFullYear(), boletim.getUTCMonth(), boletim.getUTCDate());
  const hoje = civilParts(agora);
  const b = Date.UTC(hoje.year, hoje.month - 1, hoje.day);
  return Math.floor((b - a) / 86_400_000);
}

/**
 * @param maxDias quantos dias sem boletim ainda são normais PARA ESTA CENTRAL
 *   (`CeasaCentral.maxDiasSemBoletim`). Quem chama precisa passar o valor da
 *   central para a tela e o alarme não discordarem.
 */
export function frescorDoBoletim(
  quoteDate: Date | null | undefined,
  agora: Date,
  maxDias: number = DIAS_ATE_DEFASAGEM,
): Frescor {
  if (!quoteDate) return { nivel: "ausente", dias: null };

  const dias = diasDeDiferenca(quoteDate, agora);
  // Um limiar inválido (0, negativo, nulo vindo do banco) não pode transformar
  // toda central em "defasada": cai no padrão.
  const teto = Number.isFinite(maxDias) && maxDias >= 1 ? maxDias : DIAS_ATE_DEFASAGEM;

  // Data no futuro não é erro de ninguém que a tela possa consertar (relógio do
  // servidor, boletim publicado adiantado): trata como atual em vez de mostrar
  // "-1 dia", que não quer dizer nada para quem lê.
  if (dias <= 1) return { nivel: "atual", dias };
  if (dias <= teto) return { nivel: "atrasado", dias };
  return { nivel: "defasado", dias };
}

/** Texto curto da idade, para o selo ao lado da data. */
export function rotuloDeFrescor(f: Frescor): string | null {
  switch (f.nivel) {
    case "atual":
      return null;
    case "atrasado":
      return f.dias === 2 ? "Boletim de anteontem" : `Boletim de ${f.dias} dias atrás`;
    case "defasado":
      return `Sem boletim novo há ${f.dias} dias`;
    case "ausente":
      return "Sem boletim";
  }
}
