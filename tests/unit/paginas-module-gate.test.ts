import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { modulosDoRelatorio } from "@/lib/reports/report.types";
import {
  OPTIONAL_MODULES,
  OPTIONAL_MODULE_KEYS,
  TELAS_COMPARTILHADAS,
  moduleForPath,
} from "@/lib/plan/modules";

/**
 * As PÁGINAS da área da empresa decidem assinatura e módulo por conta própria?
 *
 * Até esta auditoria, não. Os wrappers de escrita (`withTenantAction`,
 * `withTenantRoute`) já refaziam as duas checagens sem depender do middleware,
 * mas a leitura de página confiava só no `src/proxy.ts` — e o `matcher` do
 * proxy tinha um furo que soltava caminhos inteiros do middleware.
 *
 * Lê o fonte porque é o único jeito honesto de verificar: um layout de módulo é
 * um arquivo que precisa EXISTIR, e a ausência dele não quebra nada em runtime
 * — só descobre a tela em silêncio. É o mesmo raciocínio de
 * `actions-module-gate.test.ts`, que pega a action que nasceu sem `module:`.
 */

const APP = "src/app/(app)";

describe("gate de módulo nas páginas", () => {
  it("todo módulo com prefixo de rota tem um layout que o exige", () => {
    const semGate: string[] = [];

    for (const chave of OPTIONAL_MODULE_KEYS) {
      for (const prefixo of OPTIONAL_MODULES[chave].pathPrefixes) {
        const arquivo = `${APP}${prefixo}/layout.tsx`;
        if (!existsSync(arquivo)) {
          semGate.push(`${arquivo} (ausente)`);
          continue;
        }
        const src = readFileSync(arquivo, "utf8");
        if (!src.includes("requirePagina") || !src.includes(`"${chave}"`)) {
          semGate.push(`${arquivo} (não exige o módulo "${chave}")`);
        }
      }
    }

    expect(
      semGate,
      "subárvore de módulo pago sem gate de servidor: as telas ficam acessíveis " +
        "a quem não contratou por qualquer caminho que escape do middleware",
    ).toEqual([]);
  });

  it("o gate fica no LAYOUT do segmento, não nas páginas", () => {
    // Um layout de segmento é executado ao entrar na subárvore vindo de fora e
    // cobre tudo abaixo — inclusive a tela que alguém acrescentar amanhã.
    // Repetir a checagem página a página garantiria que uma ficasse de fora.
    for (const chave of OPTIONAL_MODULE_KEYS) {
      for (const prefixo of OPTIONAL_MODULES[chave].pathPrefixes) {
        expect(existsSync(`${APP}${prefixo}/layout.tsx`), `${prefixo}/layout.tsx`).toBe(true);
      }
    }
  });

  it("tela compartilhada: o layout aceita os módulos dela, e cada subtela exige o seu", () => {
    /*
      `/caixas-plasticas` é a tela de Caixas e embalagens: o layout do segmento
      deixa entrar quem tem QUALQUER um dos dois. Como layout cobre a subárvore,
      isso afrouxaria as subtelas — por isso cada pasta de rota abaixo dela
      precisa do próprio layout, exigindo o módulo que o prefixo diz ser o dono.
    */
    for (const [tela, modulos] of Object.entries(TELAS_COMPARTILHADAS)) {
      const layout = readFileSync(`${APP}${tela}/layout.tsx`, "utf8");
      expect(layout).toContain("algumModulo");
      for (const m of modulos) expect(layout, `${tela} não aceita "${m}"`).toContain(`"${m}"`);

      const subtelas = readdirSync(`${APP}${tela}`, { withFileTypes: true }).filter(
        (d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("("),
      );
      expect(subtelas.length).toBeGreaterThan(0);
      for (const d of subtelas) {
        const dono = moduleForPath(`${tela}/${d.name}`);
        expect(dono, `${tela}/${d.name} sem módulo dono`).not.toBeNull();
        const arquivo = `${APP}${tela}/${d.name}/layout.tsx`;
        expect(existsSync(arquivo), `${arquivo} (ausente)`).toBe(true);
        const src = readFileSync(arquivo, "utf8");
        expect(src.includes("requirePagina") && src.includes(`modulo: "${dono}"`), arquivo).toBe(
          true,
        );
      }
    }
  });

  it("o layout do grupo decide assinatura", () => {
    const src = readFileSync(`${APP}/layout.tsx`, "utf8");
    expect(src).toContain("accessDecision(");
    expect(src).toContain("/conta/suspensa");
  });

  it("o helper redireciona em vez de lançar", () => {
    // `ForbiddenError` num Server Component cai no error boundary e vira tela de
    // erro genérica. O proxy redireciona, e a experiência tem de continuar igual.
    const src = readFileSync("src/lib/auth/pagina.ts", "utf8");
    expect(src).toContain("isModuleEnabled(");
    expect(src).toContain("accessDecision(");
    expect(src).toContain("redirect(");
    expect(src).not.toContain("throw new ForbiddenError");
  });

  it("o gate por TIPO de relatório continua onde deve", () => {
    // `relatorios_avancados` não tem prefixo de rota: o gate é por tipo de
    // relatório, e já estava certo nos dois lugares que o consomem.
    expect(OPTIONAL_MODULES.relatorios_avancados.pathPrefixes).toEqual([]);
    for (const arquivo of [
      `${APP}/relatorios/[tipo]/page.tsx`,
      "src/app/api/reports/[type]/export/route.ts",
    ]) {
      expect(readFileSync(arquivo, "utf8")).toContain("modulosDoRelatorio(kind)");
    }
    // O pacote de relatórios E o módulo dono dos dados (auditoria 18/10).
    expect(modulosDoRelatorio("VENDAS")).toEqual([]);
    expect(modulosDoRelatorio("LUCRO_PRODUTO")).toEqual(["relatorios_avancados"]);
    expect(modulosDoRelatorio("HIGIENIZACAO")).toEqual(["relatorios_avancados", "higienizacao"]);
    expect(modulosDoRelatorio("CAIXAS_PLASTICAS")).toEqual(["relatorios_avancados", "caixas"]);
    expect(modulosDoRelatorio("EMBALAGENS")).toEqual(["relatorios_avancados", "embalagens"]);
    expect(modulosDoRelatorio("CAIXAS_PAPELAO")).toEqual(["relatorios_avancados", "embalagens"]);
  });
});
