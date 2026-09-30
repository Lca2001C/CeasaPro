/**
 * Formato do snapshot de consulta offline, e a checagem de versão dele.
 *
 * Mora aqui, e não na rota, porque três lados precisam dele: a rota que o monta
 * (`/api/pwa/snapshot`), o `offline-store` que o guarda e a tela
 * `/consulta-offline` que o lê. Arquivo de rota só pode exportar o que o Next
 * reconhece; a constante de versão não teria onde morar lá.
 *
 * **Por que existe `schemaVersion`.** O snapshot vive no IndexedDB do aparelho
 * por dias, atravessando deploys. A tela que o lê pode ser de um build diferente
 * do que o gravou — foi assim que a consulta antiga, congelada no precache do
 * service worker, quebrou quando `avisos[].total` passou a poder ser `null`. Com
 * a versão gravada junto, quem lê decide antes de tocar nos campos: formato que
 * não conhece não é renderizado.
 *
 * **Quando subir a versão:** toda mudança que um leitor antigo interpretaria
 * errado — campo removido, renomeado, tipo novo (inclusive passar a aceitar
 * `null`). Campo novo e opcional não exige. Mudou aqui, mude também
 * `SNAPSHOT_SCHEMA` em `public/sw.js` (o SW é JS puro fora do bundle e não
 * importa daqui; a divergência faz o SW mandar para /offline quem tem dados).
 */

export const PWA_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Ver o doc-comment de `GET /api/pwa/snapshot` para as decisões do formato
 * (números como `number`, listas limitadas, `cachedAt` obrigatório).
 */
export interface PwaSnapshot {
  schemaVersion: typeof PWA_SNAPSHOT_SCHEMA_VERSION;
  cachedAt: string;
  empresa: { nome: string };
  resumo: {
    hojeVendi: number;
    aReceber: number;
    estoqueValor: number;
    contasPagar: number;
  };
  /** `total` nulo = o aviso não é sobre dinheiro (ver `Aviso.total`). */
  avisos: { tipo: string; label: string; count: number; total: number | null; href: string }[];
  estoque: {
    productId: string;
    name: string;
    saleUnit: string;
    quantity: number;
    value: number;
  }[];
  fiado: {
    id: string;
    cliente: string;
    saldo: number;
    dueDate: string | null;
    caixasComCliente: number;
  }[];
  totais: { fiadoEmAberto: number; caixasComClientes: number };
}

/**
 * O que fazer com o que veio do IndexedDB.
 *
 * - `ok`: versão atual e forma esperada — pode renderizar.
 * - `obsoleto`: sem versão (gravado antes dela existir) ou versão menor. Nenhum
 *   leitor futuro vai querer isso: apagar.
 * - `futuro`: versão MAIOR que a deste código. Quem gravou foi um build mais novo
 *   e esta tela é a velha (precache ainda não trocado). Ignora, mas **não apaga** —
 *   a tela nova, quando chegar, lê normalmente.
 * - `invalido`: não é objeto, ou diz ser da versão atual sem ter a forma dela.
 *   Apagar.
 */
export type AvaliacaoSnapshot =
  | { estado: "ok"; snapshot: PwaSnapshot }
  | { estado: "obsoleto" | "futuro" | "invalido" };

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Forma mínima para a tela não quebrar. Raso de propósito: a versão já garante o
 * contrato; isto pega o registro corrompido ou gravado pela metade, não substitui
 * um schema completo.
 */
function temFormaAtual(s: Record<string, unknown>): boolean {
  return (
    typeof s.cachedAt === "string" &&
    ehObjeto(s.empresa) &&
    ehObjeto(s.resumo) &&
    ehObjeto(s.totais) &&
    Array.isArray(s.avisos) &&
    Array.isArray(s.estoque) &&
    Array.isArray(s.fiado)
  );
}

export function avaliarSnapshot(bruto: unknown): AvaliacaoSnapshot {
  if (!ehObjeto(bruto)) return { estado: "invalido" };
  const versao = bruto.schemaVersion;
  if (typeof versao !== "number" || !Number.isFinite(versao)) return { estado: "obsoleto" };
  if (versao < PWA_SNAPSHOT_SCHEMA_VERSION) return { estado: "obsoleto" };
  if (versao > PWA_SNAPSHOT_SCHEMA_VERSION) return { estado: "futuro" };
  if (!temFormaAtual(bruto)) return { estado: "invalido" };
  return { estado: "ok", snapshot: bruto as unknown as PwaSnapshot };
}
