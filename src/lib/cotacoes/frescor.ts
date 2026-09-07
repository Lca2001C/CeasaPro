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
 * A partir de quantos dias o boletim é "velho".
 *
 * Este número é o MESMO que dispara o aviso `COTACOES_DESATUALIZADAS` ao
 * super-admin. Importar dos dois lados é o que impede a tela de dizer que está
 * tudo bem enquanto o alarme grita — ou o contrário.
 *
 * Três dias cobre o pior caso normal: boletim de sexta, sábado e domingo sem
 * publicação, cliente abrindo na segunda de manhã antes do boletim do dia sair.
 */
export const DIAS_ATE_DEFASAGEM = 3;

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

export function frescorDoBoletim(quoteDate: Date | null | undefined, agora: Date): Frescor {
  if (!quoteDate) return { nivel: "ausente", dias: null };

  const dias = diasDeDiferenca(quoteDate, agora);

  // Data no futuro não é erro de ninguém que a tela possa consertar (relógio do
  // servidor, boletim publicado adiantado): trata como atual em vez de mostrar
  // "-1 dia", que não quer dizer nada para quem lê.
  if (dias <= 1) return { nivel: "atual", dias };
  if (dias <= DIAS_ATE_DEFASAGEM) return { nivel: "atrasado", dias };
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
