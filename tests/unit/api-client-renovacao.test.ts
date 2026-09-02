import { describe, it, expect, vi, afterEach } from "vitest";
import { apiGet, apiPost, renovarSessao } from "@/lib/api-client";

/**
 * Renovação transparente da sessão.
 *
 * O defeito que isto corrige veio de produção: um iPhone em
 * `/compras/nova` levou 401 do proxy ao salvar, duas vezes seguidas. A causa não
 * era o aparelho — o access token dura 15 minutos, o cookie dele expira no mesmo
 * prazo, e NADA renovava automaticamente, embora o refresh token seja válido por
 * 30 dias. Quem passasse 15 minutos preenchendo uma compra perdia o lançamento
 * inteiro, em qualquer dispositivo.
 *
 * O que os testes travam aqui:
 *  - o 401 é recuperado sem o usuário perceber, e o corpo é reenviado;
 *  - a repetição é UMA só (401 permanente não pode virar laço);
 *  - `/api/auth/*` NUNCA repete, porque o login devolve 401 para senha errada;
 *  - chamadas simultâneas compartilham uma única renovação, já que ela rotaciona
 *    o refresh token.
 */

function online() {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
}

const resposta = (status: number, corpo: unknown) =>
  ({ status, ok: status < 400, json: async () => corpo }) as unknown as Response;

const okVazio = () => resposta(200, { ok: true, data: null });
const naoAutenticado = () => resposta(401, { ok: false, error: { code: "UNAUTHORIZED" } });

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "navigator");
});

describe("recuperação do 401", () => {
  it("renova e reenvia a requisição, devolvendo o resultado bom", async () => {
    online();
    const chamadas: string[] = [];
    const fetchFalso = vi.fn(async (url: string) => {
      chamadas.push(url);
      if (url === "/api/auth/refresh") return resposta(200, { ok: true });
      // Primeira tentativa da compra: token vencido. Segunda: já renovado.
      return chamadas.filter((u) => u === "/api/compras").length === 1
        ? naoAutenticado()
        : resposta(200, { ok: true, data: { id: "compra-1" } });
    });
    vi.stubGlobal("fetch", fetchFalso);

    const res = await apiPost<{ id: string }>("/api/compras", { itens: [] });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("deveria ter salvo");
    expect(res.data.id).toBe("compra-1");
    // A ordem importa: compra → renovação → compra.
    expect(chamadas).toEqual(["/api/compras", "/api/auth/refresh", "/api/compras"]);
  });

  it("reenvia o MESMO corpo na repetição", async () => {
    online();
    const corpos: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/refresh") return resposta(200, { ok: true });
        corpos.push(String(init?.body));
        return corpos.length === 1 ? naoAutenticado() : okVazio();
      }),
    );

    await apiPost("/api/compras", { fornecedor: "Zé", total: 1234.56 });

    // Se o corpo se perdesse na repetição, a compra seria salva vazia — pior que
    // o 401, porque o usuário acharia que deu certo.
    expect(corpos).toHaveLength(2);
    expect(corpos[0]).toBe(corpos[1]);
    expect(JSON.parse(corpos[1]!)).toEqual({ fornecedor: "Zé", total: 1234.56 });
  });

  it("401 que persiste NÃO vira laço: tenta renovar uma vez e desiste", async () => {
    online();
    const fetchFalso = vi.fn(async (url: string) =>
      url === "/api/auth/refresh" ? resposta(200, { ok: true }) : naoAutenticado(),
    );
    vi.stubGlobal("fetch", fetchFalso);

    const res = await apiPost("/api/compras", {});

    expect(res.ok).toBe(false);
    // 2 tentativas da compra + 1 renovação. Nada além disso.
    expect(fetchFalso).toHaveBeenCalledTimes(3);
    if (res.ok) throw new Error("deveria ter falhado");
    expect(res.error.code).toBe("UNAUTHORIZED");
  });

  it("refresh token também inválido → mensagem clara de sessão expirada", async () => {
    online();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/auth/refresh" ? resposta(401, { ok: false }) : naoAutenticado(),
      ),
    );

    const res = await apiPost("/api/compras", {});

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("deveria ter falhado");
    expect(res.error.message).toMatch(/sess[aã]o expirou/i);
  });

  it("vale também para leitura (apiGet)", async () => {
    online();
    let tentativas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/refresh") return resposta(200, { ok: true });
        tentativas += 1;
        return tentativas === 1 ? naoAutenticado() : resposta(200, { ok: true, data: [1, 2] });
      }),
    );

    const res = await apiGet<number[]>("/api/estoque");

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("deveria ter lido");
    expect(res.data).toEqual([1, 2]);
  });
});

describe("as rotas de autenticação ficam de fora", () => {
  it("401 do login NÃO dispara renovação nem reenvio", async () => {
    online();
    const chamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        chamadas.push(url);
        return resposta(401, { ok: false, error: { code: "INVALID_CREDENTIALS" } });
      }),
    );

    const res = await apiPost("/api/auth/login", { email: "a@b.c", password: "errada" });

    // Repetir aqui gastaria o dobro do limite de tentativas de login e
    // esconderia o diagnóstico real: a senha está errada.
    expect(chamadas).toEqual(["/api/auth/login"]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("deveria ter falhado");
    expect(res.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("renovação em voo único", () => {
  it("duas chamadas simultâneas compartilham UMA renovação", async () => {
    online();
    let renovacoes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/refresh") {
          renovacoes += 1;
          await new Promise((r) => setTimeout(r, 10));
          return resposta(200, { ok: true });
        }
        return okVazio();
      }),
    );

    const [a, b, c] = await Promise.all([renovarSessao(), renovarSessao(), renovarSessao()]);

    // A renovação ROTACIONA o refresh token: a segunda chamada em paralelo
    // apresentaria um token que a primeira já revogou, e seria recusada —
    // derrubando a sessão exatamente na hora de salvar.
    expect(renovacoes).toBe(1);
    expect([a, b, c]).toEqual([true, true, true]);
  });

  it("depois de terminar, uma renovação nova é permitida", async () => {
    online();
    let renovacoes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        renovacoes += 1;
        return resposta(200, { ok: true });
      }),
    );

    await renovarSessao();
    await renovarSessao();

    // Senão um 401 mais tarde não teria como renovar de novo.
    expect(renovacoes).toBe(2);
  });

  it("falha de rede na renovação devolve false em vez de estourar", async () => {
    online();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("sem rede");
      }),
    );

    await expect(renovarSessao()).resolves.toBe(false);
  });
});
