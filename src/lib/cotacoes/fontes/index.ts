import { ceasaminas } from "./ceasaminas";
import type { FonteDeCotacao } from "./tipos";

export type { FonteDeCotacao, ResultadoDaFonte, ParametrosDeBusca } from "./tipos";

/**
 * Fontes disponíveis, por `CeasaCentral.sourceKey`.
 *
 * Acrescentar uma central de outro estado é acrescentar uma entrada aqui e uma
 * linha em `ceasa_centrals` — nada além disso muda.
 *
 * `manual` não aparece: boletim colado pelo super-admin não tem fonte para
 * buscar, e o cron precisa PULAR essas centrais em vez de tentar e falhar todo
 * dia.
 */
export const FONTES: Record<string, FonteDeCotacao> = {
  [ceasaminas.chave]: ceasaminas,
};

export function fontePara(sourceKey: string): FonteDeCotacao | null {
  return FONTES[sourceKey] ?? null;
}
