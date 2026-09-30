import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Unidade de venda de produto com histórico.
 *
 * O servidor recusa trocar a unidade de um produto com compra, venda ou
 * estoque (o histórico seria relido na unidade nova), mas a tela deixava o
 * campo livre: o dono escolhia "Quilo", salvava e só então via o erro.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const atualizarProduto = vi.hoisted(() => vi.fn());
vi.mock("@/actions/produtos.actions", () => ({
  criarProduto: vi.fn(),
  atualizarProduto,
}));

const { ProdutoForm } = await import("@/app/(app)/produtos/_components/produto-form");

const initial = {
  id: "p1",
  name: "Tomate",
  saleUnit: "CAIXA" as const,
  recipientType: null,
  qtyPerRecipient: null,
  sackCapacity: null,
  active: true,
};

beforeEach(() => {
  atualizarProduto.mockReset();
  atualizarProduto.mockResolvedValue({ ok: true, data: { id: "p1" } });
});

describe("ProdutoForm — unidade de venda", () => {
  it("com histórico, o seletor vem desabilitado e explica por quê", () => {
    render(<ProdutoForm initial={initial} temHistorico />);
    const select = screen.getByLabelText("Unidade de venda");
    expect(select).toBeDisabled();
    expect(select).toHaveAccessibleDescription(/não pode\s+mudar/);
  });

  it("com histórico, salvar ainda manda a unidade atual (o schema exige)", async () => {
    const user = userEvent.setup();
    render(<ProdutoForm initial={initial} temHistorico />);
    await user.clear(screen.getByLabelText("Nome do produto"));
    await user.type(screen.getByLabelText("Nome do produto"), "Tomate italiano");
    await user.click(screen.getByRole("button", { name: /Salvar/ }));
    await waitFor(() => expect(atualizarProduto).toHaveBeenCalledTimes(1));
    expect(atualizarProduto.mock.calls[0]![0]).toMatchObject({
      id: "p1",
      name: "Tomate italiano",
      saleUnit: "CAIXA",
    });
  });

  it("sem histórico, a unidade continua editável", () => {
    render(<ProdutoForm initial={initial} />);
    expect(screen.getByLabelText("Unidade de venda")).toBeEnabled();
  });
});
