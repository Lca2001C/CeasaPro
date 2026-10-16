import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Entrada e baixa rápidas no cartão do produto do Estoque.
 *
 * A entrada é uma compra de um item: mercadoria vira o preço unitário e a
 * descarga vira o frete — que a compra rateia no custo, chegando ao mesmo custo
 * por unidade que o card mostra.
 */
const apiPost = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiPost: (...a: unknown[]) => apiPost(...a) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), back: vi.fn() }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { AcoesRapidas } = await import("@/app/(app)/estoque/_components/acoes-rapidas");

beforeEach(() => {
  apiPost.mockReset();
  refresh.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  apiPost.mockResolvedValue({ ok: true, data: { id: "x" } });
});

function abrir(props: Partial<Parameters<typeof AcoesRapidas>[0]> = {}) {
  render(
    <AcoesRapidas
      productId="tomate"
      nome="Tomate"
      saleUnit="CAIXA"
      saldo={10}
      fornecedores={[{ id: "f1", name: "Sítio Boa Vista" }]}
      podeEntrar
      {...props}
    />,
  );
}

describe("AcoesRapidas — entrada", () => {
  it("pede a quantidade antes de abrir o card", async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByRole("button", { name: "Entrada de Tomate" }));
    expect(toast.error).toHaveBeenCalledWith("Informe a quantidade primeiro.");
    expect(screen.queryByText("Custos desta entrada")).toBeNull();
  });

  it("abre o mesmo card de custos e manda uma compra com a descarga como frete", async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByLabelText("Quantidade de Tomate"), "50");
    await user.click(screen.getByRole("button", { name: "Entrada de Tomate" }));
    expect(screen.getByText("Custos desta entrada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    expect(screen.getByText(/Informe quanto custou cada caixa/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Custo da mercadoria/), "20,00");
    await user.type(screen.getByLabelText(/Custo de descarregamento/), "1,00");
    expect(screen.getByTestId("custo-carga-unitario")).toHaveTextContent(/21,00/);
    expect(screen.getByTestId("custo-carga-total")).toHaveTextContent(/1\.050,00/);
    await user.selectOptions(screen.getByLabelText(/Fornecedor/), "f1");
    await user.click(screen.getByRole("button", { name: "Confirmar entrada" }));

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0]![0]).toBe("/api/compras");
    expect(apiPost.mock.calls[0]![1]).toMatchObject({
      supplierId: "f1",
      freight: 50,
      items: [{ productId: "tomate", quantity: 50, unitPrice: 20 }],
      pagamento: { status: "PAGO" },
    });
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText("Custos desta entrada")).toBeNull();
  });

  it("produto inativo não oferece entrada", () => {
    abrir({ podeEntrar: false });
    expect(screen.queryByRole("button", { name: "Entrada de Tomate" })).toBeNull();
  });
});

describe("AcoesRapidas — baixa", () => {
  it("dá baixa com o motivo escolhido", async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByLabelText("Quantidade de Tomate"), "3");
    await user.click(screen.getByRole("button", { name: "Dar baixa em Tomate" }));
    await user.click(screen.getByRole("button", { name: /Confirmar baixa de 3 caixas/ }));
    expect(apiPost.mock.calls[0]![0]).toBe("/api/estoque/ajuste");
    expect(apiPost.mock.calls[0]![1]).toMatchObject({
      productId: "tomate",
      type: "QUEBRA",
      quantity: 3,
    });
  });

  it("acerto para menos vai como AJUSTE negativo", async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByLabelText("Quantidade de Tomate"), "2");
    await user.click(screen.getByRole("button", { name: "Dar baixa em Tomate" }));
    await user.selectOptions(screen.getByLabelText("Motivo da baixa"), "AJUSTE_MENOS");
    await user.click(screen.getByRole("button", { name: /Confirmar baixa/ }));
    expect(apiPost.mock.calls[0]![1]).toMatchObject({ type: "AJUSTE", quantity: -2 });
  });

  it("não deixa tirar mais do que tem", async () => {
    const user = userEvent.setup();
    abrir({ saldo: 4 });
    await user.type(screen.getByLabelText("Quantidade de Tomate"), "5");
    await user.click(screen.getByRole("button", { name: "Dar baixa em Tomate" }));
    await user.click(screen.getByRole("button", { name: /Confirmar baixa/ }));
    expect(screen.getByText(/Só há 4 caixas em estoque/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("sem saldo, não há botão de baixa", () => {
    abrir({ saldo: 0 });
    expect(screen.queryByRole("button", { name: "Dar baixa em Tomate" })).toBeNull();
  });
});
