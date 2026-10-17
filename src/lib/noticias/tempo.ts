import { formatDateTime } from "@/lib/format";

/**
 * "há 25 min", "há 3 h"; depois de um dia, a data e a hora em Brasília.
 *
 * Notícia de mercado envelhece rápido — "geada amanhã" lida dois dias depois é
 * outra notícia —, então a idade aparece de forma que se leia de relance.
 */
export function idadeDaNoticia(publicadaEm: Date, agora = new Date()): string {
  const min = Math.floor((agora.getTime() - publicadaEm.getTime()) / 60_000);
  if (min < 5) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return formatDateTime(publicadaEm);
}
