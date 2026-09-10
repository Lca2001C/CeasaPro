import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * O porteiro: o que sai ANTES do JWT, e a política que vai em toda resposta.
 *
 * `src/proxy.ts` estava em 7,4% de cobertura. O `matcher` já tinha teste
 * (`proxy-matcher.test.ts`, escrito por causa de dois furos reais), mas o CORPO
 * do proxy não: nem o bypass dos caminhos de crawler, nem a CSP.
 *
 * Os dois assuntos ficam juntos aqui porque são o mesmo trecho de código e a
 * mesma decisão: alguns caminhos saem sem passar por sessão **e sem CSP**.
 * Acertar um e errar o outro é o desfecho normal quando ninguém testa nenhum.
 */

vi.mock("@/lib/auth/jwt", async () => {
  const real = await vi.importActual<typeof import("@/lib/auth/jwt")>("@/lib/auth/jwt");
  return { ...real, verifyAccess: vi.fn().mockResolvedValue(null) };
});

const { proxy } = await import("@/proxy");

const pedir = (caminho: string) =>
  proxy(new NextRequest(new URL(`http://localhost${caminho}`)));

const CABECALHO_CSP = "Content-Security-Policy";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bypass dos caminhos de crawler", () => {
  /*
    Sitemap, robots e a imagem OG saem antes do JWT e SEM CSP. O motivo está
    escrito no fonte: o Search Console e o crawler do WhatsApp buscam sem
    cookie, e passar pelo resto do proxy já fez o sitemap falhar no Console.
    XML e PNG de crawler não executam script, então a política do app não se
    aplica a eles.

    Medido no build de produção: o Next serve a imagem em `/opengraph-image`
    (com o hash em QUERY STRING, `?5350eaaf…`, que não entra no `pathname`).
  */
  const passam = ["/sitemap.xml", "/robots.txt", "/opengraph-image", "/twitter-image"];

  for (const caminho of passam) {
    it(`${caminho} sai sem redirecionar e sem CSP`, async () => {
      const r = await pedir(caminho);
      expect(r.status, `${caminho} não deveria redirecionar`).toBe(200);
      expect(r.headers.get(CABECALHO_CSP), `${caminho} não leva CSP`).toBeNull();
    });
  }

  it("o hash do Next vem em query string e não muda o caminho", async () => {
    const r = await pedir("/opengraph-image?5350eaafafa51273");
    expect(r.status).toBe(200);
  });

  /*
    O bypass é uma ALLOWLIST, e o preço de errar aqui é alto: o que sai por
    esta porta não passa por sessão, papel, assinatura, módulo nem CSP.

    A verificação era `pathname.startsWith("/opengraph-image")`, sem fronteira.
    Não era explorável — rota nasce da árvore de arquivos, não do pedido, então
    não há nada em `/opengraph-image-qualquer-coisa` para servir — mas é
    exatamente o formato de furo que `proxy-matcher.test.ts` existe para pegar,
    e a mesma lista logo acima já usava `=== p || startsWith(p + "/")`.
  */
  const naoPassam = [
    "/opengraph-image/segredo",
    "/opengraph-imagex/admin",
    "/opengraph-image-admin/dashboard",
    "/twitter-image/../admin",
    "/opengraph-imagens",
  ];

  for (const caminho of naoPassam) {
    it(`${caminho} NÃO herda o bypass`, async () => {
      const r = await pedir(caminho);
      // Sem sessão, caminho protegido redireciona para o login — e leva CSP.
      expect(r.status, `${caminho} escapou do proxy`).toBe(307);
      expect(r.headers.get(CABECALHO_CSP)).toBeTruthy();
    });
  }

  it("o sufixo com hífen continua aceito — é o formato que o fonte documenta", async () => {
    // O comentário do proxy registra que o Next pode servir a OG como
    // `/opengraph-image-abc`. A versão atual usa query string, mas o formato
    // segue aceito para não quebrar o preview num upgrade do framework.
    expect((await pedir("/opengraph-image-a1b2c3")).status).toBe(200);
  });
});

describe("CSP", () => {
  it("vai em toda resposta que o proxy devolve, inclusive nos redirects", async () => {
    // `comCsp` embrulha `next()`, `redirect()` e os JSON de erro. Um caminho
    // que escape disso entrega HTML sem política.
    const login = await pedir("/login");
    const protegido = await pedir("/dashboard");

    expect(login.headers.get(CABECALHO_CSP)).toBeTruthy();
    expect(protegido.status).toBe(307);
    expect(protegido.headers.get(CABECALHO_CSP)).toBeTruthy();
  });

  it("API sem sessão devolve 401 COM CSP, e não redireciona", async () => {
    /*
      Duas regras num caso. O 401 (em vez de 3xx) existe porque o `api-client`
      o reconhece, renova com o refresh token e repete a requisição — um 3xx
      para um `fetch` de gravação faria o formulário perder o que foi digitado.
      E mesmo a resposta de erro leva a política.
    */
    const r = await pedir("/api/vendas");
    expect(r.status).toBe(401);
    expect(r.headers.get(CABECALHO_CSP)).toBeTruthy();
  });

  it("o nonce é DIFERENTE a cada requisição", async () => {
    /*
      O nonce é o que sustenta `script-src 'self' 'nonce-…' 'strict-dynamic'`.
      Um nonce fixo (constante de módulo, cache, valor de build) transformaria
      a política em decoração: quem descobrisse o valor uma vez injetaria
      script para sempre.
    */
    const nonceDe = (h: string | null) => /'nonce-([^']+)'/.exec(h ?? "")?.[1];

    const a = nonceDe((await pedir("/login")).headers.get(CABECALHO_CSP));
    const b = nonceDe((await pedir("/login")).headers.get(CABECALHO_CSP));

    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("as diretivas que fecham a porta estão presentes", async () => {
    const csp = (await pedir("/login")).headers.get(CABECALHO_CSP)!;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    // `frame-ancestors 'none'` é o que impede clickjacking do painel.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("'strict-dynamic'");
  });

  it("em produção NÃO libera 'unsafe-eval'", async () => {
    // `unsafe-eval` existe só em dev, porque o React usa eval para reconstruir
    // stack de erro. Vazar isso para produção anularia boa parte da política.
    const csp = (await pedir("/login")).headers.get(CABECALHO_CSP)!;
    expect(csp).not.toContain("unsafe-eval");
  });

  it("as frouxuras do pagamento são LIMITADAS ao que o 3DS exige", async () => {
    /*
      `frame-src https:` e `form-action https:` são largas de propósito: o
      desafio 3-D Secure abre no domínio do banco emissor, que não dá para
      saber em build. O que NÃO pode afrouxar junto é `script-src` — é ele que
      decide o que executa.
    */
    const csp = (await pedir("/login")).headers.get(CABECALHO_CSP)!;
    const scriptSrc = /script-src ([^;]+)/.exec(csp)![1]!;

    expect(csp).toContain("frame-src");
    expect(scriptSrc).not.toContain("https:");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("`upgrade-insecure-requests` só entra quando a origem é HTTPS", async () => {
    const semTls = await proxy(new NextRequest(new URL("http://localhost/login")));
    expect(semTls.headers.get(CABECALHO_CSP)).not.toContain("upgrade-insecure-requests");

    const comTls = await proxy(
      new NextRequest(new URL("http://localhost/login"), {
        headers: { "x-forwarded-proto": "https" },
      }),
    );
    expect(comTls.headers.get(CABECALHO_CSP)).toContain("upgrade-insecure-requests");
  });

  it("lê o ÚLTIMO hop de x-forwarded-proto, não o primeiro", async () => {
    /*
      A cadeia chega como "cliente, proxy1, proxy2". Quem manda é o hop mais
      próximo — o primeiro valor é o que o cliente afirmou, e cliente não é
      fonte confiável para decidir se a conexão é segura.
    */
    const r = await proxy(
      new NextRequest(new URL("http://localhost/login"), {
        headers: { "x-forwarded-proto": "https, http" },
      }),
    );
    expect(r.headers.get(CABECALHO_CSP)).not.toContain("upgrade-insecure-requests");
  });
});
