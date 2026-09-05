import { describe, it, expect } from "vitest";
import {
  planModules,
  moduleForPath,
  isModuleEnabled,
  requireModule,
  ALL_OPTIONAL_KEYS,
} from "@/lib/plan/modules";
import { ForbiddenError } from "@/lib/http/app-error";

describe("planModules", () => {
  it("plano sem features → todos os módulos (retrocompatível)", () => {
    expect(planModules(null).sort()).toEqual([...ALL_OPTIONAL_KEYS].sort());
    expect(planModules(undefined).sort()).toEqual([...ALL_OPTIONAL_KEYS].sort());
    expect(planModules({}).sort()).toEqual([...ALL_OPTIONAL_KEYS].sort());
  });

  it("lê a lista de módulos do features", () => {
    expect(planModules({ modules: ["caixas"] })).toEqual(["caixas"]);
  });

  it("ignora chaves inválidas", () => {
    expect(planModules({ modules: ["caixas", "hackermodule", 123] })).toEqual(["caixas"]);
  });

  it("lista vazia = nenhum opcional", () => {
    expect(planModules({ modules: [] })).toEqual([]);
  });
});

describe("moduleForPath", () => {
  it("mapeia caminhos opcionais", () => {
    expect(moduleForPath("/caixas-plasticas")).toBe("caixas");
    expect(moduleForPath("/caixas-plasticas/novo")).toBe("caixas");
    expect(moduleForPath("/higienizacao")).toBe("higienizacao");
    expect(moduleForPath("/embalagens/nova")).toBe("embalagens");
  });

  it("núcleo → null", () => {
    expect(moduleForPath("/dashboard")).toBeNull();
    expect(moduleForPath("/produtos")).toBeNull();
    expect(moduleForPath("/relatorios")).toBeNull();
    expect(moduleForPath("/plano")).toBeNull();
  });
});

describe("isModuleEnabled", () => {
  // Era o contrário: `undefined` liberava tudo, para o rollout do claim ser
  // suave. O problema é que `undefined` tinha dois donos — "token legado" e
  // "super-admin" — e a colisão obrigava o guard a ser permissivo para todo
  // mundo, inclusive para uma sessão forjada sem o claim. Hoje `build-session`
  // emite a lista sempre, e o super-admin recebe a lista completa explícita.
  it("sem a lista, NADA é liberado (fail-closed)", () => {
    expect(isModuleEnabled(undefined, "caixas")).toBe(false);
  });
  it("respeita a lista", () => {
    expect(isModuleEnabled(["caixas"], "caixas")).toBe(true);
    expect(isModuleEnabled(["caixas"], "higienizacao")).toBe(false);
    expect(isModuleEnabled([], "caixas")).toBe(false);
  });
});

describe("requireModule (guard de servidor)", () => {
  it("passa quando o módulo está na lista", () => {
    expect(() => requireModule(["caixas"], "caixas")).not.toThrow();
  });
  it("lança quando a lista não veio — sessão sem claim não é sessão liberada", () => {
    expect(() => requireModule(undefined, "caixas")).toThrow(ForbiddenError);
  });
  it("lança ForbiddenError quando o módulo não está no plano", () => {
    expect(() => requireModule([], "caixas")).toThrow(ForbiddenError);
    expect(() => requireModule(["higienizacao"], "caixas")).toThrow(/plano/i);
  });
});
