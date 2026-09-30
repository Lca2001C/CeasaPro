/**
 * Endereço de registro do service worker, com a versão do build.
 *
 * O navegador só instala um SW novo quando os BYTES do script mudam ou quando o
 * ENDEREÇO registrado muda. O `public/sw.js` é um arquivo fixo: sem mudança de
 * bytes, deploy nenhum trocava o SW, e o precache de /offline e /consulta-offline
 * ficava congelado no build da primeira instalação (com JS que já não entendia o
 * snapshot atual). Registrar `/sw.js?v=<build>` faz cada deploy ser um endereço
 * novo: o navegador baixa, instala, e o SW lê a versão do próprio endereço
 * (`self.location`) para nomear o cache e apagar os de builds anteriores.
 *
 * A versão chega aqui como `process.env.CEASAPRO_SW_VERSION`, substituída pelo
 * valor literal no build (ver `next.config.ts`). Vazia (não deveria acontecer em
 * produção), registra `/sw.js` puro — o comportamento de antes, que ainda
 * funciona, só não se renova sozinho.
 */
export function urlDoServiceWorker(versao: string | undefined | null): string {
  const v = (versao ?? "").trim();
  return v ? `/sw.js?v=${encodeURIComponent(v)}` : "/sw.js";
}
