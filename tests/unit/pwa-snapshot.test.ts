import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  avaliarSnapshot,
  PWA_SNAPSHOT_SCHEMA_VERSION,
  type PwaSnapshot,
} from "@/lib/pwa/snapshot";
import {
  carregarSnapshot,
  CHAVE_ULTIMO_SYNC,
  limparSnapshotNoLogout,
  salvarSnapshot,
} from "@/lib/pwa/offline-store";
import { urlDoServiceWorker } from "@/lib/pwa/sw-version";

/**
 * O snapshot offline atravessa deploys no aparelho: quem lê pode ser de outro
 * build. Foi assim que a consulta antiga (congelada no precache do SW) quebrou
 * quando `avisos[].total` passou a aceitar `null`. A versão de formato decide
 * ANTES de a tela tocar nos campos.
 */

function snapshotAtual(extra: Partial<PwaSnapshot> = {}): PwaSnapshot {
  return {
    schemaVersion: PWA_SNAPSHOT_SCHEMA_VERSION,
    cachedAt: "2026-09-30T12:00:00.000Z",
    empresa: { nome: "Box 1" },
    resumo: { hojeVendi: 10, aReceber: 20, estoqueValor: 30, contasPagar: 0 },
    avisos: [{ tipo: "fiado", label: "2 fiados", count: 2, total: null, href: "/fiado" }],
    estoque: [],
    fiado: [],
    totais: { fiadoEmAberto: 0, caixasComClientes: 0 },
    ...extra,
  };
}

/** Cópia sem um campo (o registro gravado por outro build, ou pela metade). */
function semCampo<T extends object>(obj: T, campo: keyof T): Record<string, unknown> {
  const copia = { ...obj } as Record<string, unknown>;
  delete copia[campo as string];
  return copia;
}

describe("avaliarSnapshot", () => {
  it("versão atual com a forma esperada: ok", () => {
    const s = snapshotAtual();
    expect(avaliarSnapshot(s)).toEqual({ estado: "ok", snapshot: s });
  });

  it("sem versão (gravado antes dela existir): obsoleto", () => {
    expect(avaliarSnapshot(semCampo(snapshotAtual(), "schemaVersion")).estado).toBe("obsoleto");
  });

  it("versão menor: obsoleto", () => {
    expect(avaliarSnapshot({ ...snapshotAtual(), schemaVersion: 0 }).estado).toBe("obsoleto");
  });

  it("versão maior (esta tela é a velha): futuro — ignorado, não apagado", () => {
    expect(
      avaliarSnapshot({ ...snapshotAtual(), schemaVersion: PWA_SNAPSHOT_SCHEMA_VERSION + 1 }).estado,
    ).toBe("futuro");
  });

  it.each([
    ["nulo", null],
    ["texto", "x"],
    ["lista", []],
    ["versão como texto", { ...snapshotAtual(), schemaVersion: "1" }],
  ])("%s: não é snapshot legível", (_nome, bruto) => {
    expect(avaliarSnapshot(bruto).estado).not.toBe("ok");
  });

  it("diz ser da versão atual sem a forma dela (gravado pela metade): inválido", () => {
    expect(avaliarSnapshot(semCampo(snapshotAtual(), "avisos")).estado).toBe("invalido");
    expect(avaliarSnapshot({ ...snapshotAtual(), resumo: null }).estado).toBe("invalido");
  });
});

// ─── offline-store com um IndexedDB mínimo em memória ───

function instalarIndexedDbFalso() {
  const bancos = new Map<string, Map<string, Map<string, unknown>>>();
  const assincrono = (fn: () => void) => setTimeout(fn, 0);

  function pedidoDe<T>(executar: () => T) {
    const req: { result?: T; onsuccess?: () => void; onerror?: () => void } = {};
    assincrono(() => {
      req.result = executar();
      req.onsuccess?.();
    });
    return req;
  }

  const indexedDB = {
    open(nome: string) {
      const req: Record<string, unknown> & {
        result?: unknown;
        onupgradeneeded?: () => void;
        onsuccess?: () => void;
      } = {};
      assincrono(() => {
        const novo = !bancos.has(nome);
        if (novo) bancos.set(nome, new Map());
        const lojas = bancos.get(nome)!;
        const db = {
          objectStoreNames: { contains: (l: string) => lojas.has(l) },
          createObjectStore: (l: string) => lojas.set(l, new Map()),
          close: () => undefined,
          transaction: (l: string) => {
            const tx: { oncomplete?: () => void; onabort?: () => void; objectStore: () => unknown } = {
              objectStore: () => {
                const loja = lojas.get(l)!;
                const fim = <T>(r: ReturnType<typeof pedidoDe<T>>) => {
                  assincrono(() => assincrono(() => tx.oncomplete?.()));
                  return r;
                };
                return {
                  get: (k: string) => fim(pedidoDe(() => loja.get(k))),
                  put: (v: unknown, k: string) =>
                    fim(
                      pedidoDe(() => {
                        loja.set(k, structuredClone(v));
                        return k;
                      }),
                    ),
                  delete: (k: string) =>
                    fim(
                      pedidoDe(() => {
                        loja.delete(k);
                        return undefined;
                      }),
                    ),
                };
              },
            };
            return tx;
          },
        };
        req.result = db;
        if (novo) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };

  const armazenamento = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => armazenamento.get(k) ?? null,
    setItem: (k: string, v: string) => armazenamento.set(k, v),
    removeItem: (k: string) => armazenamento.delete(k),
  };
  Object.assign(globalThis, { indexedDB, localStorage });
  const guardado = () => bancos.get("ceasapro-offline")?.get("snapshot")?.get("atual");
  return { armazenamento, guardado };
}

describe("offline-store — versão do snapshot", () => {
  let armazenamento: Map<string, string>;
  let guardado: () => unknown;
  beforeEach(() => {
    ({ armazenamento, guardado } = instalarIndexedDbFalso());
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).indexedDB;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("guarda e devolve o snapshot da versão atual", async () => {
    expect(await salvarSnapshot(snapshotAtual())).toBe(true);
    expect((await carregarSnapshot())?.empresa.nome).toBe("Box 1");
  });

  it("snapshot de formato antigo: não é devolvido, é apagado e zera o debounce", async () => {
    await salvarSnapshot(semCampo(snapshotAtual(), "schemaVersion") as unknown as PwaSnapshot);
    armazenamento.set(CHAVE_ULTIMO_SYNC, String(Date.now()));

    expect(await carregarSnapshot()).toBeNull();
    // Apagou mesmo, em vez de só não devolver.
    expect(guardado()).toBeUndefined();
    // Sem a marca, o próximo Início grava um snapshot novo em vez de esperar 5 min.
    expect(armazenamento.has(CHAVE_ULTIMO_SYNC)).toBe(false);
  });

  it("snapshot de formato mais novo: ignorado, mas preservado para a tela nova", async () => {
    const futuro = { ...snapshotAtual(), schemaVersion: PWA_SNAPSHOT_SCHEMA_VERSION + 1 };
    await salvarSnapshot(futuro as unknown as PwaSnapshot);
    armazenamento.set(CHAVE_ULTIMO_SYNC, "1");

    expect(await carregarSnapshot()).toBeNull();
    expect(guardado()).toMatchObject({ schemaVersion: PWA_SNAPSHOT_SCHEMA_VERSION + 1 });
    expect(armazenamento.get(CHAVE_ULTIMO_SYNC)).toBe("1");

    // O logout, esse sim, apaga qualquer versão (é privacidade, não formato).
    await limparSnapshotNoLogout();
    expect(guardado()).toBeUndefined();
    expect(armazenamento.has(CHAVE_ULTIMO_SYNC)).toBe(false);
  });

  it("sem IndexedDB (aba privada, política): null, sem exceção", async () => {
    delete (globalThis as Record<string, unknown>).indexedDB;
    expect(await carregarSnapshot()).toBeNull();
  });
});

describe("urlDoServiceWorker", () => {
  it("põe a versão do build no endereço — cada deploy vira um SW novo", () => {
    expect(urlDoServiceWorker("dpl_abc")).toBe("/sw.js?v=dpl_abc");
    expect(urlDoServiceWorker("a b/c")).toBe("/sw.js?v=a%20b%2Fc");
  });

  it("sem versão, cai no endereço antigo (funciona, só não se renova)", () => {
    expect(urlDoServiceWorker(undefined)).toBe("/sw.js");
    expect(urlDoServiceWorker("  ")).toBe("/sw.js");
  });
});
