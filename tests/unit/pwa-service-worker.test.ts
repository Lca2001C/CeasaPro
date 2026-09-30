import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { PWA_SNAPSHOT_SCHEMA_VERSION } from "@/lib/pwa/snapshot";

/**
 * O `public/sw.js` roda FORA do bundle e nenhum teste o importava: o E2E prova o
 * fallback offline, mas não a troca de versão, que só aparece entre dois deploys.
 * Aqui o arquivo real é executado num sandbox com `self`, `caches` e `fetch`
 * falsos, e os eventos são disparados à mão.
 *
 * O que está travado: cada build (`?v=`) ganha um cache com o próprio nome; o
 * activate apaga os caches dos builds anteriores (e com eles os chunks velhos);
 * ícone revalida em segundo plano em vez de ficar preso no cache; API e HTML
 * autenticado não passam pelo cache; os handlers de push continuam registrados.
 */

const FONTE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGEM = "https://app.ceasapro.test";

type Ouvinte = (evento: unknown) => void;

/** CacheStorage mínimo: nome → (url → Response). */
function criarCaches(inicial: Record<string, Record<string, string>> = {}) {
  const lojas = new Map<string, Map<string, Response>>();
  const chave = (req: Request | string) => new URL(typeof req === "string" ? req : req.url, ORIGEM).href;
  const abrir = (nome: string) => {
    if (!lojas.has(nome)) lojas.set(nome, new Map());
    const loja = lojas.get(nome)!;
    return {
      match: async (req: Request | string) => loja.get(chave(req))?.clone(),
      put: async (req: Request | string, res: Response) => {
        loja.set(chave(req), res);
      },
      add: async (url: string) => {
        const res = await (globalFetch.atual as typeof fetch)(url);
        if (!res.ok) throw new Error("add falhou");
        loja.set(chave(url), res);
      },
      addAll: async (urls: string[]) => {
        for (const u of urls) {
          const res = await (globalFetch.atual as typeof fetch)(u);
          if (!res.ok) throw new Error("addAll falhou");
          loja.set(chave(u), res);
        }
      },
    };
  };
  for (const [nome, entradas] of Object.entries(inicial)) {
    const c = abrir(nome);
    for (const [url, corpo] of Object.entries(entradas)) void c.put(url, new Response(corpo));
  }
  const globalFetch: { atual: unknown } = { atual: null };
  return {
    globalFetch,
    lojas,
    api: {
      keys: async () => [...lojas.keys()],
      open: async (nome: string) => abrir(nome),
      delete: async (nome: string) => lojas.delete(nome),
      match: async (req: Request | string) => {
        for (const loja of lojas.values()) {
          const hit = loja.get(chave(req));
          if (hit) return hit.clone();
        }
        return undefined;
      },
    },
    async texto(nome: string, url: string) {
      const res = lojas.get(nome)?.get(new URL(url, ORIGEM).href);
      return res ? res.clone().text() : undefined;
    },
  };
}

function carregarSw({
  href = `${ORIGEM}/sw.js?v=build-novo`,
  caches = criarCaches(),
  fetchImpl = vi.fn(async () => new Response("rede")),
}: {
  href?: string;
  caches?: ReturnType<typeof criarCaches>;
  fetchImpl?: ReturnType<typeof vi.fn>;
} = {}) {
  const ouvintes = new Map<string, Ouvinte>();
  caches.globalFetch.atual = fetchImpl;
  const self = {
    location: new URL(href),
    addEventListener: (tipo: string, fn: Ouvinte) => ouvintes.set(tipo, fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => []) },
    registration: { showNotification: vi.fn(async () => undefined) },
  };
  // Sem `indexedDB` no sandbox: o SW tem de tratar como "sem snapshot".
  const ctx = vm.createContext({
    self,
    caches: caches.api,
    fetch: fetchImpl,
    URL,
    Request,
    Response,
    Promise,
    Set,
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(FONTE, ctx, { filename: "sw.js" });

  /** Dispara um evento e espera tudo que ele pendurou em `waitUntil`/`respondWith`. */
  async function disparar(tipo: string, extra: Record<string, unknown> = {}) {
    const pendentes: Promise<unknown>[] = [];
    let resposta: Promise<Response> | undefined;
    const evento = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => pendentes.push(p),
      respondWith: (p: Promise<Response>) => {
        resposta = Promise.resolve(p);
        pendentes.push(resposta);
      },
    };
    ouvintes.get(tipo)!(evento);
    // `waitUntil` pode ser chamado de dentro de um `respondWith` ainda pendente.
    for (let i = 0; i < pendentes.length; i++) await pendentes[i]!.catch(() => undefined);
    return { resposta: resposta ? await resposta : undefined, respondeu: resposta !== undefined };
  }

  const pegar = <T>(expr: string) => vm.runInContext(expr, ctx) as T;
  return { ouvintes, self, disparar, pegar, caches, fetchImpl };
}

const pedido = (caminho: string, { mode, ...init }: RequestInit & { mode?: string } = {}) => {
  const req = new Request(`${ORIGEM}${caminho}`, init);
  // `Request` do Node não aceita `mode: "navigate"`; o SW só lê a propriedade.
  if (mode) Object.defineProperty(req, "mode", { value: mode });
  return req;
};

describe("service worker — versão por build", () => {
  it("nomeia o cache com a versão do próprio endereço", () => {
    const { pegar } = carregarSw({ href: `${ORIGEM}/sw.js?v=dpl_abc123` });
    expect(pegar<string>("VERSAO")).toBe("dpl_abc123");
    expect(pegar<string>("CACHE")).toBe("ceasapro-static-v7-dpl_abc123");
  });

  it("builds diferentes dão caches diferentes (é isto que renova o precache)", () => {
    const a = carregarSw({ href: `${ORIGEM}/sw.js?v=a1` }).pegar<string>("CACHE");
    const b = carregarSw({ href: `${ORIGEM}/sw.js?v=b2` }).pegar<string>("CACHE");
    expect(a).not.toBe(b);
  });

  it("registro sem ?v (endereço antigo) continua funcionando", () => {
    const { pegar } = carregarSw({ href: `${ORIGEM}/sw.js` });
    expect(pegar<string>("CACHE")).toBe("ceasapro-static-v7-sem-versao");
  });

  it("sanitiza a versão, que vira nome de cache", () => {
    const { pegar } = carregarSw();
    const versao = pegar<(h: string) => string>("versaoDoEndereco");
    expect(versao(`${ORIGEM}/sw.js?v=${encodeURIComponent("a/b c<>")}`)).toBe("abc");
    expect(versao(`${ORIGEM}/sw.js?v=${"x".repeat(200)}`)).toHaveLength(80);
    expect(versao("não é url")).toBe("sem-versao");
  });

  it("cachesObsoletos: os nossos de outros builds saem; o atual e os alheios ficam", () => {
    const { pegar } = carregarSw();
    const obsoletos = pegar<(k: string[], a: string) => string[]>("cachesObsoletos");
    expect(
      obsoletos(
        ["ceasapro-static-v6", "ceasapro-static-v7-velho", "ceasapro-static-v7-novo", "outro-app"],
        "ceasapro-static-v7-novo",
      ),
    ).toEqual(["ceasapro-static-v6", "ceasapro-static-v7-velho"]);
  });

  it("activate apaga o cache fixo antigo e o do build anterior, com os chunks deles", async () => {
    const caches = criarCaches({
      "ceasapro-static-v6": { "/offline": "velho", "/_next/static/chunks/a-111.js": "a" },
      "ceasapro-static-v7-build-velho": { "/_next/static/chunks/b-222.js": "b" },
      "ceasapro-static-v7-build-novo": { "/offline": "novo" },
      "outro-app": { "/x": "x" },
    });
    const sw = carregarSw({ caches });
    await sw.disparar("activate");
    expect([...caches.lojas.keys()].sort()).toEqual(["ceasapro-static-v7-build-novo", "outro-app"]);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it("install precacheia as páginas de fallback do build atual e os chunks delas", async () => {
    const html = (nome: string) =>
      `<html><script src="/_next/static/chunks/${nome}.js?dpl=x"></script>` +
      `<link href="/_next/static/css/app.css" rel="stylesheet"></html>`;
    const fetchImpl = vi.fn(async (url: string | Request) => {
      const caminho = new URL(typeof url === "string" ? url : url.url, ORIGEM).pathname;
      if (caminho === "/offline") return new Response(html("offline-1"));
      if (caminho === "/consulta-offline") return new Response(html("consulta-1"));
      return new Response(`conteudo de ${caminho}`);
    });
    const sw = carregarSw({ fetchImpl });
    await sw.disparar("install");

    const cache = sw.pegar<string>("CACHE");
    const loja = sw.caches.lojas.get(cache)!;
    const caminhos = [...loja.keys()].map((u) => new URL(u).pathname + new URL(u).search).sort();
    expect(caminhos).toEqual([
      "/_next/static/chunks/consulta-1.js?dpl=x",
      "/_next/static/chunks/offline-1.js?dpl=x",
      "/_next/static/css/app.css",
      "/consulta-offline",
      "/icons/icon-192.png",
      "/offline",
    ]);
    // Sem o cache HTTP do navegador: pegar o HTML velho apontaria para chunks mortos.
    expect(fetchImpl).toHaveBeenCalledWith("/offline", { cache: "reload" });
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });
});

describe("service worker — estratégia por requisição", () => {
  it("ícone: responde do cache e atualiza em segundo plano (stale-while-revalidate)", async () => {
    const caches = criarCaches({
      "ceasapro-static-v7-build-novo": { "/icons/icon-192.png": "icone-velho" },
    });
    const fetchImpl = vi.fn(async () => new Response("icone-novo"));
    const sw = carregarSw({ caches, fetchImpl });

    const { resposta } = await sw.disparar("fetch", { request: pedido("/icons/icon-192.png") });
    expect(await resposta!.text()).toBe("icone-velho");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await caches.texto("ceasapro-static-v7-build-novo", "/icons/icon-192.png")).toBe(
      "icone-novo",
    );
  });

  it("ícone sem rede: o do cache vale, sem erro", async () => {
    const caches = criarCaches({
      "ceasapro-static-v7-build-novo": { "/icons/icon-192.png": "icone" },
    });
    const sw = carregarSw({
      caches,
      fetchImpl: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });
    const { resposta } = await sw.disparar("fetch", { request: pedido("/icons/icon-192.png") });
    expect(await resposta!.text()).toBe("icone");
  });

  it("chunk do Next: cache-first, sem ir à rede quando já tem", async () => {
    const caches = criarCaches({
      "ceasapro-static-v7-build-novo": { "/_next/static/chunks/a-1.js": "chunk" },
    });
    const sw = carregarSw({ caches });
    const { resposta } = await sw.disparar("fetch", {
      request: pedido("/_next/static/chunks/a-1.js"),
    });
    expect(await resposta!.text()).toBe("chunk");
    expect(sw.fetchImpl).not.toHaveBeenCalled();
  });

  it("chunk novo entra no cache DESTE build", async () => {
    const sw = carregarSw({ fetchImpl: vi.fn(async () => new Response("chunk-da-rede")) });
    await sw.disparar("fetch", { request: pedido("/_next/static/chunks/b-2.js") });
    expect(await sw.caches.texto("ceasapro-static-v7-build-novo", "/_next/static/chunks/b-2.js")).toBe(
      "chunk-da-rede",
    );
  });

  it.each(["/api/pwa/snapshot", "/dashboard", "/sw.js"])(
    "%s não passa pelo cache (vai direto à rede)",
    async (caminho) => {
      const sw = carregarSw();
      const { respondeu } = await sw.disparar("fetch", { request: pedido(caminho) });
      expect(respondeu).toBe(false);
    },
  );

  it("POST nunca é interceptado", async () => {
    const sw = carregarSw();
    const { respondeu } = await sw.disparar("fetch", {
      request: pedido("/_next/static/chunks/a.js", { method: "POST", body: "x" }),
    });
    expect(respondeu).toBe(false);
  });

  it("navegação: rede primeiro, e a resposta NÃO é guardada", async () => {
    const sw = carregarSw({ fetchImpl: vi.fn(async () => new Response("html autenticado")) });
    const { resposta } = await sw.disparar("fetch", {
      request: pedido("/fiado", { mode: "navigate" }),
    });
    expect(await resposta!.text()).toBe("html autenticado");
    expect([...(sw.caches.lojas.get("ceasapro-static-v7-build-novo")?.keys() ?? [])]).toEqual([]);
  });

  it("navegação sem rede e sem snapshot legível: /offline do cache do build", async () => {
    const caches = criarCaches({
      "ceasapro-static-v7-build-novo": { "/offline": "pagina offline", "/consulta-offline": "consulta" },
    });
    const sw = carregarSw({
      caches,
      fetchImpl: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });
    const { resposta } = await sw.disparar("fetch", {
      request: pedido("/produtos", { mode: "navigate" }),
    });
    expect(await resposta!.text()).toBe("pagina offline");
  });
});

describe("service worker — snapshot e push", () => {
  it("só conta como snapshot o da versão de formato que a consulta deste build lê", () => {
    const legivel = carregarSw().pegar<(r: unknown) => boolean>("snapshotLegivel");
    expect(legivel({ schemaVersion: PWA_SNAPSHOT_SCHEMA_VERSION })).toBe(true);
    expect(legivel({ cachedAt: "2026-01-01" })).toBe(false); // gravado antes da versão
    expect(legivel({ schemaVersion: PWA_SNAPSHOT_SCHEMA_VERSION + 1 })).toBe(false);
    expect(legivel(null)).toBe(false);
    expect(legivel(undefined)).toBe(false);
  });

  it("a versão do snapshot no SW é a mesma do app (duplicação consciente)", () => {
    expect(carregarSw().pegar<number>("SNAPSHOT_SCHEMA")).toBe(PWA_SNAPSHOT_SCHEMA_VERSION);
  });

  it("continua ouvindo push, clique e troca de inscrição", () => {
    const { ouvintes } = carregarSw();
    for (const tipo of ["install", "activate", "fetch", "push", "notificationclick", "pushsubscriptionchange"]) {
      expect(ouvintes.has(tipo), tipo).toBe(true);
    }
  });
});
