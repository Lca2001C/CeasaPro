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
// v7: um cache POR BUILD. Este arquivo tem bytes fixos, e o navegador só troca o
// SW quando os bytes ou o ENDEREÇO mudam — então nenhum deploy o trocava, e o
// precache de /offline e /consulta-offline ficava congelado no build da primeira
// instalação (a consulta velha quebrava com `avisos[].total = null`), enquanto o
// cache de /_next/static crescia com os chunks de todos os deploys. Agora o app
// registra `/sw.js?v=<build>` (`src/lib/pwa/sw-version.ts`): cada deploy é um
// endereço novo, logo um install novo, que refaz o precache num cache com o nome
// do build; o activate apaga os caches dos builds anteriores (e, com eles, os
// chunks velhos). Ícones passam a revalidar em segundo plano.

/**
 * Versão do build, lida do próprio endereço (`?v=`). Sanitizada porque vira
 * nome de cache; ausente (registro antigo, sem `?v`) vira "sem-versao" — o SW
 * funciona igual, só não se distingue de outro registro sem versão.
 */
function versaoDoEndereco(href) {
  try {
    const v = new URL(href).searchParams.get("v") || "";
    return v.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) || "sem-versao";
  } catch {
    return "sem-versao";
  }
}

const PREFIXO_CACHE = "ceasapro-";
const VERSAO = versaoDoEndereco(self.location.href);
const CACHE = `${PREFIXO_CACHE}static-v7-${VERSAO}`;
const OFFLINE_URL = "/offline";
const CONSULTA_URL = "/consulta-offline";
const PAGINAS_FALLBACK = [OFFLINE_URL, CONSULTA_URL];
const PRECACHE = ["/icons/icon-192.png"];

// Espelham `src/lib/pwa/offline-store.ts` e `src/lib/pwa/snapshot.ts`.
// Duplicação consciente: o SW é JS puro, fora do bundle, e não pode importar do
// app. Se mudar lá, mudar aqui.
const IDB_NOME = "ceasapro-offline";
const IDB_LOJA = "snapshot";
const IDB_CHAVE = "atual";
const SNAPSHOT_SCHEMA = 1;

/**
 * Caches a apagar no activate: todo cache NOSSO (prefixo `ceasapro-`) que não
 * seja o deste build — as versões fixas antigas (`ceasapro-static-v6`) e os de
 * builds anteriores. É assim que os chunks de /_next/static dos deploys passados
 * saem do aparelho: eles só existem nesses caches. Cache sem o prefixo não é do
 * app e fica.
 */
function cachesObsoletos(chaves, atual) {
  return chaves.filter((k) => k !== atual && k.startsWith(PREFIXO_CACHE));
}

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
      .then((keys) => Promise.all(cachesObsoletos(keys, CACHE).map((k) => caches.delete(k))))
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
          // Só conta o snapshot que a /consulta-offline DESTE build sabe ler; o de
          // outro formato ela descartaria, e abrir a consulta para dizer "nenhum
          // dado salvo" é pior que a /offline.
          terminar(snapshotLegivel(leitura.result));
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

/** Espelha o caso `ok` de `avaliarSnapshot` (só a versão; a forma é da tela). */
function snapshotLegivel(registro) {
  return Boolean(registro) && registro.schemaVersion === SNAPSHOT_SCHEMA;
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

  // Demais requisições (API, HTML autenticado, outras origens) vão sempre à rede,
  // sem passar pelo cache.
  if (url.origin !== self.location.origin) return;

  // Chunks do Next: cache-first. O nome leva hash do conteúdo, então o arquivo
  // de um endereço nunca muda — e o cache é do build, apagado no próximo deploy.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, req));
    return;
  }

  // Ícones: stale-while-revalidate. O nome NÃO leva hash (`/icons/icon-192.png`),
  // então cache-first puro prendia o ícone antigo para sempre depois de um
  // redesenho. Responde do cache na hora e atualiza em segundo plano.
  if (url.pathname.startsWith("/icons/")) {
    event.respondWith(staleWhileRevalidate(event, req));
  }
});

async function cacheFirst(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) event.waitUntil(cache.put(req, res.clone()).catch(() => undefined));
  return res;
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const daRede = fetch(req).then(async (res) => {
    if (res.ok) await cache.put(req, res.clone()).catch(() => undefined);
    return res;
  });
  if (hit) {
    // Sem rede a atualização falha em silêncio: o ícone do cache já foi servido.
    event.waitUntil(daRede.catch(() => undefined));
    return hit;
  }
  return daRede;
}

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
 * Antes o SW só fazia `postMessage` para as janelas abertas — e nenhum código
 * do app escutava. O endpoint antigo passava a responder 410, o cron apagava a
 * linha e o aparelho nunca mais recebia aviso, sem explicação. Agora o próprio
 * SW reinscreve (quando o navegador não já entregou a nova) e registra a nova
 * inscrição no servidor: o `fetch` do SW é da mesma origem e leva o cookie de
 * sessão. Access token vencido (15 min) → renova uma vez e repete.
 *
 * Tudo best-effort: sem sessão renovável (logout, refresh vencido), o POST
 * falha e a próxima visita a Configurações reafirma a inscrição, como antes.
 */
async function registrarInscricaoNoServidor(inscricao) {
  const enviar = () =>
    fetch("/api/pwa/push", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inscricao.toJSON()),
    });
  let res = await enviar();
  if (res.status === 401) {
    const renovou = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => null);
    if (renovou && renovou.ok) res = await enviar();
  }
  return res.ok;
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const antiga = event.oldSubscription || null;
      let nova = event.newSubscription || null;

      // Firefox entrega o evento sem `newSubscription`: a inscrição nova tem de
      // ser criada aqui, com a mesma chave VAPID da antiga.
      if (!nova && antiga && antiga.options && antiga.options.applicationServerKey) {
        try {
          nova = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: antiga.options.applicationServerKey,
          });
        } catch {
          nova = null;
        }
      }
      if (!nova) {
        try {
          nova = await self.registration.pushManager.getSubscription();
        } catch {
          nova = null;
        }
      }

      if (nova) {
        try {
          const ok = await registrarInscricaoNoServidor(nova);
          // Só depois da nova registrada: remover a antiga antes deixaria o
          // aparelho sem inscrição nenhuma se o POST falhasse.
          if (ok && antiga && antiga.endpoint && antiga.endpoint !== nova.endpoint) {
            await fetch("/api/pwa/push", {
              method: "DELETE",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: antiga.endpoint }),
            }).catch(() => undefined);
          }
        } catch {
          // Sem rede agora: a reafirmação em Configurações ainda cobre.
        }
      }

      // Continua avisando as janelas abertas (inofensivo, e útil a quem vier a
      // escutar para atualizar o estado do botão de notificações).
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const janela of janelas) {
        janela.postMessage({ tipo: "push-subscription-change" });
      }
    })(),
  );
});
