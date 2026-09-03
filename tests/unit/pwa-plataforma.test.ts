import { describe, expect, it } from "vitest";
import { detectarPlataforma, ehIOS } from "@/lib/pwa/plataforma";

/**
 * User agents reais. São a entrada do único ponto do PWA onde um erro de
 * detecção produz instrução ERRADA na tela — mandar quem está no Chrome do
 * iPhone procurar "Adicionar à Tela de Início" é mandá-lo procurar o que não
 * existe ali.
 */
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) CriOS/120.0.6099.101 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) EdgiOS/120.0.2210.61 Version/17.0 Mobile/15E148 Safari/604.1",
  ipadOS:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Safari/537.36",
} as const;

describe("ehIOS", () => {
  it("reconhece iPhone", () => {
    expect(ehIOS(UA.iphoneSafari, 5)).toBe(true);
  });

  it("reconhece iPadOS 13+, que se anuncia como Macintosh", () => {
    // O user agent é idêntico ao do Mac; só o toque separa os dois.
    expect(ehIOS(UA.ipadOS, 5)).toBe(true);
  });

  it("não confunde Mac sem toque com iPad", () => {
    expect(ehIOS(UA.macSafari, 0)).toBe(false);
  });

  it("Android e desktop não são iOS", () => {
    expect(ehIOS(UA.androidChrome, 5)).toBe(false);
    expect(ehIOS(UA.desktopChrome, 0)).toBe(false);
  });
});

describe("detectarPlataforma", () => {
  it("Safari no iPhone recebe o passo a passo", () => {
    expect(detectarPlataforma(UA.iphoneSafari, 5)).toBe("ios-safari");
  });

  it("iPadOS pelo Safari também", () => {
    expect(detectarPlataforma(UA.ipadOS, 5)).toBe("ios-safari");
  });

  it.each([
    ["Chrome", UA.iphoneChrome],
    ["Firefox", UA.iphoneFirefox],
    ["Edge", UA.iphoneEdge],
  ])("%s no iPhone não tem caminho de instalação", (_nome, ua) => {
    // Todos usam o motor do Safari, mas nenhum oferece "Adicionar à Tela de
    // Início" com suporte a PWA — a tela precisa mandar abrir no Safari.
    expect(detectarPlataforma(ua, 5)).toBe("ios-outro");
  });

  it("Android e desktop caem no fluxo nativo", () => {
    expect(detectarPlataforma(UA.androidChrome, 5)).toBe("outro");
    expect(detectarPlataforma(UA.desktopChrome, 0)).toBe("outro");
  });

  it("Chrome no iPhone não é confundido com Chrome no Android", () => {
    // Os dois trazem "Chrome"/"CriOS"; o que decide é o iOS, não o navegador.
    expect(detectarPlataforma(UA.iphoneChrome, 5)).not.toBe(
      detectarPlataforma(UA.androidChrome, 5),
    );
  });
});
