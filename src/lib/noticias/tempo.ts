import { formatDateTime } from "@/lib/format";

/**
 * "Há 25 minutos", "Há 3 horas"; depois de um dia, a data e a hora em Brasília.
 *
 * Notícia de mercado envelhece rápido — "geada amanhã" lida dois dias depois é
 * outra notícia —, então a idade aparece de forma que se leia de relance, por
 * extenso como no g1.
 */
export function idadeDaNoticia(publicadaEm: Date, agora = new Date()): string {
  const min = Math.floor((agora.getTime() - publicadaEm.getTime()) / 60_000);
  if (min < 5) return "Agora há pouco";
  if (min < 60) return `Há ${min} minutos`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "Há 1 hora" : `Há ${h} horas`;
  return formatDateTime(publicadaEm);
}
