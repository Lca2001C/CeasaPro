import { describe, it, expect, vi, afterEach } from "vitest";
import { apiPost, apiGet } from "@/lib/api-client";

/**
 * Regra central do PWA: nenhuma escrita financeira é enfileirada offline.
 *
 * O que estes testes protegem é o "de imediato": sem a checagem, o `fetch` sairia
 * e só falharia no timeout — no balcão, isso é o cliente esperando para descobrir
 * que nada foi salvo. Por isso a asserção mais importante aqui não é a mensagem,
 * é que **`fetch` nem chega a ser chamado**.
 */

function definirOnline(online: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: online },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "navigator");
});

describe("apiPost sem conexao", () => {
  it("recusa antes de tentar a rede", async () => {
    definirOnline(false);
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    const res = await apiPost("/api/vendas", { qualquer: "coisa" });

    expect(res.ok).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("afirma que NADA foi registrado", async () => {
    // A dúvida "salvou ou não?" é o pior resultado possível numa venda.
    definirOnline(false);
    vi.stubGlobal("fetch", vi.fn());

    const res = await apiPost("/api/vendas", {});

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("deveria ter falhado");
    expect(res.error.code).toBe("OFFLINE");
    expect(res.error.message).toMatch(/nada foi registrado/i);
  });

  it("online, deixa a requisicao seguir normalmente", async () => {
    definirOnline(true);
    const fetchFalso = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { id: "1" } }),
    });
    vi.stubGlobal("fetch", fetchFalso);

    const res = await apiPost<{ id: string }>("/api/vendas", {});

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it("sem navigator (SSR/ambiente sem DOM), nao bloqueia", async () => {
    // `navigator` ausente não é sinal de offline; bloquear ali quebraria qualquer
    // execução fora do navegador.
    Reflect.deleteProperty(globalThis, "navigator");
    const fetchFalso = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, data: null }) });
    vi.stubGlobal("fetch", fetchFalso);

    await apiPost("/api/vendas", {});

    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});

describe("apiGet sem conexao", () => {
  it("aponta o caminho que EXISTE sem rede", async () => {
    definirOnline(false);
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    const res = await apiGet("/api/billing/status");

    expect(fetchFalso).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("deveria ter falhado");
    expect(res.error.message).toMatch(/consulta offline/i);
  });
});
