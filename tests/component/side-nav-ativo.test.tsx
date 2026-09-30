import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { hrefAtual } from "@/components/layout/item-atual";

/**
 * Em /vendas/nova, "Vender (PDV)" e "Vendas" casavam por prefixo e os dois
 * ficavam com `aria-current="page"`: o leitor de tela anunciava duas páginas
 * atuais. Só o item mais específico é o atual.
 */
const rota = vi.hoisted(() => ({ atual: "/vendas/nova" }));
vi.mock("next/navigation", () => ({ usePathname: () => rota.atual }));
vi.mock("@/lib/sair", () => ({ sair: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { SideNav } = await import("@/components/layout/side-nav");

describe("hrefAtual", () => {
  const hrefs = ["/dashboard", "/vendas/nova", "/vendas", "/fiado"];
  it.each([
    ["/vendas/nova", "/vendas/nova"],
    ["/vendas", "/vendas"],
    ["/vendas/abc123", "/vendas"],
    ["/vendas/novaX", "/vendas"],
    ["/fiado/1", "/fiado"],
    ["/outra", null],
  ])("%s → %s", (pathname, esperado) => {
    expect(hrefAtual(hrefs, pathname)).toBe(esperado);
  });
});

describe("SideNav", () => {
  it("no PDV, só 'Vender (PDV)' é a página atual", () => {
    rota.atual = "/vendas/nova";
    render(<SideNav modules={[]} />);
    const atuais = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(atuais.map((l) => l.textContent)).toEqual(["Vender (PDV)"]);
  });

  it("no detalhe de uma venda, só 'Vendas'", () => {
    rota.atual = "/vendas/xyz";
    render(<SideNav modules={[]} />);
    const atuais = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(atuais.map((l) => l.textContent)).toEqual(["Vendas"]);
  });
});
