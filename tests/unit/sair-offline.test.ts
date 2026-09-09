import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Sair sem internet tem de apagar o dado local e AVISAR.
 *
 * O `fetch` para `/api/auth/logout` falha no box com sinal ruim — que é o
 * cenário para o qual o PWA existe — e o service worker não intercepta POST.
 * O `await` sem `try` derrubava o resto da função: o snapshot de consulta
 * (estoque, nomes de clientes e quanto cada um deve) continuava no aparelho,
 * legível em `/consulta-offline` sem sessão, e nada aparecia na tela. Como
 * todos os chamadores usavam `void encerrarSessao()` e o projeto não tem
 * handler de `unhandledrejection`, a falha morria em silêncio: a pessoa ia
 * embora achando que tinha saído.
 *
 * Num celular compartilhado entre dois boxes, é o movimento da empresa que fica
 * para o próximo que abrir o app.
 */

const espiao = vi.hoisted(() => ({
  limpou: 0,
  navegou: [] as string[],
}));

vi.mock("@/lib/pwa/offline-store", () => ({
  limparSnapshotNoLogout: vi.fn(async () => {
    espiao.limpou += 1;
  }),
}));

// `irComSessaoNova` chama `window.location.assign`. Mockar o próprio módulo
// não serviria: `encerrarSessao` chama a função vizinha diretamente, e o mock
// parcial só troca o que sai do módulo. Então o `window` é que é mínimo aqui —
// e é ele que registra se houve navegação.
beforeEach(() => {
  vi.stubGlobal("window", {
    location: {
      assign: (destino: string) => {
        espiao.navegou.push(destino);
      },
    },
  });
  espiao.limpou = 0;
  espiao.navegou = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encerrarSessao", () => {
  it("sem rede: apaga o snapshot, avisa e NÃO finge que saiu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { encerrarSessao } = await import("@/lib/session-nav");

    const r = await encerrarSessao();

    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/internet/i);
    // O dado do aparelho sai de qualquer forma — é o risco real no celular
    // compartilhado.
    expect(espiao.limpou).toBe(1);
    // E não navega: o cookie é httpOnly e continua válido, então ir para /login
    // devolveria a pessoa ao sistema, com cara de botão quebrado.
    expect(espiao.navegou).toEqual([]);
  });

  it("com rede: apaga o snapshot e sai, como antes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const { encerrarSessao } = await import("@/lib/session-nav");

    const r = await encerrarSessao();

    expect(r.ok).toBe(true);
    expect(r.mensagem).toBeUndefined();
    expect(espiao.limpou).toBe(1);
    expect(espiao.navegou).toEqual(["/login"]);
  });

  it("a ordem é apagar ANTES de navegar", async () => {
    // Navegar primeiro abandonaria a limpeza no meio: o documento novo cancela
    // o script em execução.
    const ordem: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    vi.stubGlobal("window", {
      location: {
        assign: () => {
          ordem.push("navegou");
        },
      },
    });
    const store = await import("@/lib/pwa/offline-store");
    vi.mocked(store.limparSnapshotNoLogout).mockImplementation(async () => {
      ordem.push("limpou");
    });

    const { encerrarSessao } = await import("@/lib/session-nav");
    await encerrarSessao();

    expect(ordem).toEqual(["limpou", "navegou"]);
  });
});
