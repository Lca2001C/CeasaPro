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
  it("token legado (undefined) → tudo liberado", () => {
    expect(isModuleEnabled(undefined, "caixas")).toBe(true);
  });
  it("respeita a lista", () => {
    expect(isModuleEnabled(["caixas"], "caixas")).toBe(true);
    expect(isModuleEnabled(["caixas"], "higienizacao")).toBe(false);
    expect(isModuleEnabled([], "caixas")).toBe(false);
  });
});

describe("requireModule (guard de servidor)", () => {
  it("passa quando habilitado e quando token é legado", () => {
    expect(() => requireModule(["caixas"], "caixas")).not.toThrow();
    expect(() => requireModule(undefined, "caixas")).not.toThrow();
  });
  it("lança ForbiddenError quando o módulo não está no plano", () => {
    expect(() => requireModule([], "caixas")).toThrow(ForbiddenError);
    expect(() => requireModule(["higienizacao"], "caixas")).toThrow(/plano/i);
  });
});
