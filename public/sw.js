// Service worker do CeasaPro.
//
// Cacheia apenas o casco estático (app shell) e serve uma página de fallback nas
// navegações sem rede. Dados e páginas dinâmicas NUNCA são cacheados aqui — o
// que existe para consulta offline é o snapshot em IndexedDB, gravado pelo app e
// lido pela página /consulta-offline, sempre com a hora de origem visível.
//
// v4: passa a preferir /consulta-offline quando existe snapshot no aparelho.
// Mandar para /offline (que só diz "sem conexão") quando há dados salvos seria
// esconder do usuário justamente o que ele tem.
const CACHE = "ceasapro-static-v4";
const OFFLINE_URL = "/offline";
const CONSULTA_URL = "/consulta-offline";
const PRECACHE = [OFFLINE_URL, CONSULTA_URL, "/icons/icon-192.png"];

// Espelham `src/lib/pwa/offline-store.ts`. Duplicação consciente: o SW é JS puro,
// fora do bundle, e não pode importar do app. Se mudar lá, mudar aqui.
const IDB_NOME = "ceasapro-offline";
const IDB_LOJA = "snapshot";
const IDB_CHAVE = "atual";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Existe snapshot guardado?
 *
 * Abre o IndexedDB em modo leitura e NUNCA cria o banco: `onupgradeneeded` aqui
 * significaria que o app nunca gravou nada, então o SW aborta em vez de criar um
 * banco vazio que confundiria o app depois. Qualquer falha responde `false` — na
 * dúvida, mostrar /offline é melhor que abrir uma tela de consulta sem dados.
 */
function temSnapshot() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(IDB_NOME);
    } catch {
      resolve(false);
      return;
    }
    // Timeout: se o IDB travar (acontece com armazenamento sob pressão), a
    // navegação não pode ficar pendurada esperando.
    const limite = setTimeout(() => resolve(false), 1500);
    const terminar = (v) => {
      clearTimeout(limite);
      resolve(v);
    };

    req.onupgradeneeded = () => {
      // Banco inexistente: aborta para não deixar um vazio criado pelo SW.
      try {
        req.transaction.abort();
      } catch {
        /* nada a fazer */
      }
      terminar(false);
    };
    req.onerror = () => terminar(false);
    req.onblocked = () => terminar(false);
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains(IDB_LOJA)) {
          db.close();
          terminar(false);
          return;
        }
        const leitura = db.transaction(IDB_LOJA, "readonly").objectStore(IDB_LOJA).get(IDB_CHAVE);
        leitura.onsuccess = () => {
          db.close();
          terminar(Boolean(leitura.result));
        };
        leitura.onerror = () => {
          db.close();
          terminar(false);
        };
      } catch {
        db.close();
        terminar(false);
      }
    };
  });
}

async function destinoOffline() {
  const cache = await caches.open(CACHE);
  if (await temSnapshot()) {
    const consulta = await cache.match(CONSULTA_URL);
    if (consulta) return consulta;
  }
  return cache.match(OFFLINE_URL);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Navegações (trocar de página): tenta a rede; sem rede, escolhe o fallback.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => destinoOffline()));
    return;
  }

  // Assets estáticos (cache-first). Demais requisições vão sempre à rede.
  const isStatic =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"));
  if (!isStatic) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }),
  );
});
