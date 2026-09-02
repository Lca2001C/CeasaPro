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
// v5: recebe Web Push e trata o clique na notificação.
// v6: pré-cacheia os ASSETS das páginas de fallback, não só o HTML. Sem os chunks
// de JS o documento abria offline e ficava preso em "Carregando…" — o React nunca
// hidratava, e a tela de consulta não mostrava os dados que já estavam no aparelho.
const CACHE = "ceasapro-static-v6";
const OFFLINE_URL = "/offline";
const CONSULTA_URL = "/consulta-offline";
const PAGINAS_FALLBACK = [OFFLINE_URL, CONSULTA_URL];
const PRECACHE = ["/icons/icon-192.png"];

// Espelham `src/lib/pwa/offline-store.ts`. Duplicação consciente: o SW é JS puro,
// fora do bundle, e não pode importar do app. Se mudar lá, mudar aqui.
const IDB_NOME = "ceasapro-offline";
const IDB_LOJA = "snapshot";
const IDB_CHAVE = "atual";

/**
 * Guarda uma página de fallback COM os assets que ela carrega.
 *
 * Os nomes dos chunks levam hash do build, então não há lista fixa a manter: o
 * HTML recém-buscado é a fonte da verdade, e o que ele referencia em
 * /_next/static é exatamente o que a página precisa para hidratar offline.
 *
 * `cache: "reload"` ignora o cache HTTP do navegador — num deploy novo, pegar a
 * versão antiga aqui deixaria o documento apontando para chunks que não existem
 * mais no servidor.
 */
async function precachearPagina(cache, url) {
  const res = await fetch(url, { cache: "reload" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(url, res);

  const assets = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
    assets.add(m[1]);
  }
  // `allSettled`: um asset que falhe não pode derrubar o install — um install
  // rejeitado significa NENHUM service worker, o que é muito pior que um cache
  // incompleto (a próxima navegação online conserta).
  await Promise.allSettled([...assets].map((a) => cache.add(a)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled([
        cache.addAll(PRECACHE),
        ...PAGINAS_FALLBACK.map((u) => precachearPagina(cache, u)),
      ]);
      await self.skipWaiting();
    })(),
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

// ─────────────────── Web Push ───────────────────

/**
 * Notificação recebida.
 *
 * O corpo é JSON montado por `push-server.ts`. Se vier vazio ou ilegível — o
 * serviço de push pode entregar um "wake up" sem payload — ainda mostramos algo
 * genérico: no Chrome, um evento push sem `showNotification` faz o navegador
 * exibir "Este site foi atualizado em segundo plano", que é pior que uma mensagem
 * nossa.
 */
self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = {};
  }

  const titulo = dados.title || "CeasaPro";
  const opcoes = {
    body: dados.body || "Você tem avisos no CeasaPro.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // `tag` agrupa: um aviso novo de fiado SUBSTITUI o anterior em vez de
    // empilhar. Três notificações da mesma coisa treinam o usuário a ignorar.
    tag: dados.tag || "ceasapro",
    renotify: true,
    data: { url: dados.url || "/dashboard" },
    lang: "pt-BR",
  };

  // `waitUntil` é obrigatório: sem ele o SW pode ser encerrado antes de a
  // notificação aparecer, e o evento se perde sem erro visível.
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

/**
 * Clique na notificação.
 *
 * Se já existe uma janela do app aberta, foca ELA e navega — abrir uma segunda
 * janela do mesmo app é o comportamento que mais irrita em PWA instalado.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const janela of janelas) {
        // Mesma origem: reaproveita a janela existente.
        if (new URL(janela.url).origin === self.location.origin) {
          await janela.focus();
          if ("navigate" in janela) {
            await janela.navigate(destino).catch(() => undefined);
          }
          return;
        }
      }
      await self.clients.openWindow(destino);
    })(),
  );
});

/**
 * O navegador trocou a inscrição por conta própria (acontece: rotação de chave,
 * atualização do serviço de push). Sem tratar, a inscrição antiga morre em
 * silêncio e o usuário para de receber sem saber por quê.
 *
 * Aqui só avisamos as janelas abertas; quem reinscreve é o app, que tem a sessão.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const janela of janelas) {
        janela.postMessage({ tipo: "push-subscription-change" });
      }
    })(),
  );
});
