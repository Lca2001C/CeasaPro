import type { PwaSnapshot } from "@/app/api/pwa/snapshot/route";

/**
 * Snapshot de consulta offline, guardado em IndexedDB.
 *
 * Por que IndexedDB e não localStorage: o snapshot tem listas (estoque, fiado) e
 * pode passar de algumas centenas de KB — o limite prático do localStorage é ~5 MB
 * COMPARTILHADO e o acesso é síncrono, ou seja, bloquearia a thread principal na
 * hora de abrir a tela. O IndexedDB é assíncrono e feito para isso.
 *
 * Por que só um registro (`CHAVE_UNICA`): é o retrato mais recente de UMA empresa.
 * Guardar histórico não serviria para consulta e viraria dado desatualizado
 * competindo com o atual.
 *
 * **Tudo aqui falha em silêncio, de propósito.** Modo privado, armazenamento
 * bloqueado por política do dispositivo, cota esgotada e o Safari descartando dados
 * de sites pouco usados são todos cenários normais — não erros. Um app que estoura
 * exceção porque não conseguiu guardar cache offline fica pior do que se não
 * tivesse tentado. Quem chama trata `null` como "não tenho dados", que é um estado
 * previsto da tela.
 */

const BANCO = "ceasapro-offline";
const VERSAO = 1;
const LOJA = "snapshot";
const CHAVE_UNICA = "atual";

function suportado(): boolean {
  return typeof indexedDB !== "undefined";
}

function abrir(): Promise<IDBDatabase | null> {
  if (!suportado()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(BANCO, VERSAO);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOJA)) db.createObjectStore(LOJA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // Outra aba segurando uma versão antiga: não vale travar a tela esperando.
    req.onblocked = () => resolve(null);
  });
}

function transacionar<T>(
  modo: IDBTransactionMode,
  fn: (loja: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return abrir().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(LOJA, modo);
          const req = fn(tx.objectStore(LOJA));
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
          tx.oncomplete = () => db.close();
          tx.onabort = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      }),
  );
}

/** Guarda o snapshot mais recente. Devolve `false` se não foi possível. */
export async function salvarSnapshot(snapshot: PwaSnapshot): Promise<boolean> {
  const r = await transacionar("readwrite", (loja) => loja.put(snapshot, CHAVE_UNICA));
  // `put` resolve com a chave; `null` significa que não deu.
  return r !== null;
}

/** Snapshot guardado, ou `null` se não houver (estado normal, não erro). */
export async function carregarSnapshot(): Promise<PwaSnapshot | null> {
  const r = await transacionar<PwaSnapshot>("readonly", (loja) => loja.get(CHAVE_UNICA));
  return r ?? null;
}

/**
 * Apaga o snapshot. Chamado no LOGOUT.
 *
 * É requisito de privacidade, não limpeza: o snapshot tem estoque, nomes de
 * clientes e quanto cada um deve. Num celular compartilhado, deixá-lo depois do
 * logout entregaria o movimento da empresa para o próximo que abrisse o app —
 * inclusive sem sessão, porque a tela offline lê do IndexedDB e não do servidor.
 */
export async function limparSnapshotNoLogout(): Promise<void> {
  await transacionar("readwrite", (loja) => loja.delete(CHAVE_UNICA));
}

/** Idade do snapshot em minutos, ou `null` se não houver data válida. */
export function idadeEmMinutos(snapshot: PwaSnapshot | null): number | null {
  if (!snapshot?.cachedAt) return null;
  const t = Date.parse(snapshot.cachedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}
