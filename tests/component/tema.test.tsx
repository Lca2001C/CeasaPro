import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CHAVE_DO_TEMA, COR_DA_BARRA, SCRIPT_DO_TEMA } from "@/lib/tema";
import { AtalhoDeTema, SeletorDeTema } from "@/components/tema/controles-de-tema";

/**
 * Tema Claro / Escuro / Automático: o script do `<head>` (antes da pintura) e
 * os dois controles (Configurações e atalho do menu).
 */

let sistemaEscuro = false;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="${COR_DA_BARRA.claro}">
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${COR_DA_BARRA.escuro}">`;
  sistemaEscuro = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      matches: q.includes("dark") ? sistemaEscuro : false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

const rodarScript = () => new Function(SCRIPT_DO_TEMA)();
const escuro = () => document.documentElement.classList.contains("dark");

describe("script do <head>", () => {
  it("sem escolha salva, segue o sistema", () => {
    sistemaEscuro = true;
    rodarScript();
    expect(escuro()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("escolha manual vence o sistema, nos dois sentidos", () => {
    sistemaEscuro = true;
    localStorage.setItem(CHAVE_DO_TEMA, "claro");
    rodarScript();
    expect(escuro()).toBe(false);

    sistemaEscuro = false;
    localStorage.setItem(CHAVE_DO_TEMA, "escuro");
    rodarScript();
    expect(escuro()).toBe(true);
  });

  it("não quebra a página se o localStorage falhar", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(() => rodarScript()).not.toThrow();
    getItem.mockRestore();
  });
});

describe("SeletorDeTema (Configurações)", () => {
  it("é um grupo de rádio e aplica e salva a escolha", async () => {
    const user = userEvent.setup();
    render(<SeletorDeTema />);
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Automático" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(screen.getByRole("radio", { name: "Escuro" }));
    expect(localStorage.getItem(CHAVE_DO_TEMA)).toBe("escuro");
    expect(escuro()).toBe(true);
    expect(screen.getByRole("radio", { name: "Escuro" })).toHaveAttribute("aria-checked", "true");
    // Escolhido à mão, a barra do sistema segue o tema nas duas faixas.
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      expect(m.getAttribute("content")).toBe(COR_DA_BARRA.escuro);
    }
  });

  it("setas mudam a opção (padrão de rádio)", async () => {
    const user = userEvent.setup();
    render(<SeletorDeTema />);
    screen.getByRole("radio", { name: "Automático" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(localStorage.getItem(CHAVE_DO_TEMA)).toBe("claro");
    expect(screen.getByRole("radio", { name: "Claro" })).toHaveFocus();
  });

  it("voltar ao automático devolve cada meta à sua faixa", async () => {
    const user = userEvent.setup();
    render(<SeletorDeTema />);
    await user.click(screen.getByRole("radio", { name: "Escuro" }));
    await user.click(screen.getByRole("radio", { name: "Automático" }));
    const [clara, escura] = document.querySelectorAll('meta[name="theme-color"]');
    expect(clara!.getAttribute("content")).toBe(COR_DA_BARRA.claro);
    expect(escura!.getAttribute("content")).toBe(COR_DA_BARRA.escuro);
  });
});

describe("AtalhoDeTema (menu)", () => {
  it("diz o tema atual e um toque passa para o próximo", async () => {
    const user = userEvent.setup();
    localStorage.setItem(CHAVE_DO_TEMA, "claro");
    render(<AtalhoDeTema />);
    const botao = screen.getByRole("button", { name: /Tema: Claro/ });
    await user.click(botao);
    expect(localStorage.getItem(CHAVE_DO_TEMA)).toBe("escuro");
    expect(screen.getByRole("button", { name: /Tema: Escuro/ })).toBeInTheDocument();
  });
});
