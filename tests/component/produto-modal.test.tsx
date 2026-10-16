import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Modal "Novo Produto" do Estoque.
 *
 * - Embalagem de produto com histórico: o servidor recusa trocar (o histórico
 *   seria relido na unidade nova), então a tela trava o campo e explica.
 * - Estoque inicial pede o custo: sem ele a entrada valeria R$ 0 e o lucro das
 *   primeiras vendas sairia inflado.
 * - Sem armazenamento configurado, os botões de foto ficam desabilitados e o
 *   cadastro segue.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const criarProduto = vi.hoisted(() => vi.fn());
const atualizarProduto = vi.hoisted(() => vi.fn());
vi.mock("@/actions/produtos.actions", () => ({
  criarProduto,
  atualizarProduto,
  enviarFotoProduto: vi.fn(),
  buscarFotosDoBanco: vi.fn(),
}));

const { ProdutoModal } = await import("@/components/produtos/produto-modal");

const produto = {
  id: "p1",
  name: "Tomate",
  saleUnit: "CAIXA" as const,
  salePrice: 100,
  minStock: null,
  imageKey: null,
  imageUrl: null,
  recipientType: null,
  qtyPerRecipient: null,
  sackCapacity: null,
  active: true,
  temHistorico: true,
};

const resposta = { ok: true, data: { id: "p1", name: "Tomate", saleUnit: "CAIXA" } };

beforeEach(() => {
  criarProduto.mockReset();
  atualizarProduto.mockReset();
  criarProduto.mockResolvedValue(resposta);
  atualizarProduto.mockResolvedValue(resposta);
});

function abrir(props: Partial<Parameters<typeof ProdutoModal>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onSalvo = vi.fn();
  render(
    <ProdutoModal
      open
      onOpenChange={onOpenChange}
      fotosDisponiveis={false}
      onSalvo={onSalvo}
      {...props}
    />,
  );
  return { onOpenChange, onSalvo };
}

describe("ProdutoModal — embalagem", () => {
  it("com histórico, o seletor vem desabilitado e explica por quê", () => {
    abrir({ produto });
    const select = screen.getByLabelText("Embalagem");
    expect(select).toBeDisabled();
    expect(select).toHaveAccessibleDescription(/não pode\s+mudar/);
  });

  it("com histórico, salvar ainda manda a embalagem atual (o schema exige)", async () => {
    const user = userEvent.setup();
    const { onSalvo, onOpenChange } = abrir({ produto });
    const nome = screen.getByLabelText(/Nome do Produto/);
    await user.clear(nome);
    await user.type(nome, "Tomate italiano");
    await user.click(screen.getByRole("button", { name: /Salvar/ }));
    await waitFor(() => expect(atualizarProduto).toHaveBeenCalledTimes(1));
    expect(atualizarProduto.mock.calls[0]![0]).toMatchObject({
      id: "p1",
      name: "Tomate italiano",
      saleUnit: "CAIXA",
      salePrice: 100,
    });
    // Edição não manda estoque inicial: depois do cadastro, só compra ou ajuste.
    expect(atualizarProduto.mock.calls[0]![0]).not.toHaveProperty("estoqueInicial");
    expect(onSalvo).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sem histórico, a embalagem continua editável", () => {
    abrir({ produto: { ...produto, temHistorico: false } });
    expect(screen.getByLabelText("Embalagem")).toBeEnabled();
  });
});

describe("ProdutoModal — cadastro", () => {
  it("o custo só aparece com estoque inicial, e é obrigatório", async () => {
    const user = userEvent.setup();
    abrir();
    expect(screen.queryByLabelText(/Quanto custou/)).toBeNull();

    await user.type(screen.getByLabelText(/Nome do Produto/), "Batata");
    await user.type(screen.getByLabelText("Estoque Inicial"), "10");
    expect(screen.getByLabelText(/Quanto custou cada caixa/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salvar Produto" }));
    expect(await screen.findByText(/Informe quanto custou/)).toBeInTheDocument();
    expect(criarProduto).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Quanto custou/), "45,50");
    await user.click(screen.getByRole("button", { name: "Salvar Produto" }));
    await waitFor(() => expect(criarProduto).toHaveBeenCalledTimes(1));
    expect(criarProduto.mock.calls[0]![0]).toMatchObject({
      name: "Batata",
      saleUnit: "CAIXA",
      estoqueInicial: 10,
      custoInicial: 45.5,
      imageKey: null,
    });
  });

  it("sem armazenamento, os botões de foto ficam desabilitados com aviso", () => {
    abrir();
    expect(screen.getByRole("button", { name: /Câmera/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Galeria/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Banco/ })).toBeDisabled();
    expect(screen.getByText(/envio de fotos ainda não está disponível/)).toBeInTheDocument();
  });
});
