import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { moduleForPath } from "@/lib/plan/modules";

/**
 * O manifest é a única parte do app que o SISTEMA OPERACIONAL lê, e ele lê uma
 * vez: o Android guarda o que estava no arquivo no momento da instalação. Um
 * ícone com caminho errado ou um atalho para tela bloqueada não aparece como
 * erro em lugar nenhum — só como app quebrado no celular do comerciante, sem
 * conserto a não ser reinstalar.
 */
const m = manifest();
const publico = (src: string) => join(process.cwd(), "public", src);

describe("manifest do PWA", () => {
  it("abre instalado, não numa aba do navegador", () => {
    expect(m.display).toBe("standalone");
    // `display_override` é a rede de segurança: sem ela, navegador que não
    // implemente `standalone` cai direto em `browser` — o modo que o PWA existe
    // para evitar.
    expect(m.display_override?.[0]).toBe("standalone");
    expect(m.display_override).not.toContain("browser");
  });

  it("todo ícone declarado existe em public/", () => {
    for (const icon of m.icons ?? []) {
      expect(existsSync(publico(icon.src)), `ícone ausente: ${icon.src}`).toBe(true);
    }
  });

  it("tem um ícone maskable, senão o Android corta o logo na máscara", () => {
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
  });

  describe("atalhos do toque longo no ícone", () => {
    const shortcuts = m.shortcuts ?? [];

    it("existem", () => {
      expect(shortcuts.length).toBeGreaterThan(0);
    });

    it("nunca apontam para módulo opcional", () => {
      // O atalho é gravado no ícone na instalação e não sabe qual plano a
      // empresa contratou. Um atalho para /caixas-plasticas numa empresa sem o
      // módulo levaria direto a uma tela negada.
      for (const s of shortcuts) {
        expect(moduleForPath(s.url), `atalho gateado: ${s.url}`).toBeNull();
      }
    });

    it("ficam dentro do escopo do app", () => {
      // Fora do `scope` o atalho abre no navegador, não no app instalado.
      for (const s of shortcuts) {
        expect(s.url.startsWith(m.scope ?? "/")).toBe(true);
      }
    });

    it("usam ícones que existem", () => {
      for (const s of shortcuts) {
        for (const icon of s.icons ?? []) {
          expect(existsSync(publico(icon.src)), `ícone ausente: ${icon.src}`).toBe(true);
        }
      }
    });
  });

  it("start_url está dentro do escopo", () => {
    expect(m.start_url?.startsWith(m.scope ?? "/")).toBe(true);
  });
});
