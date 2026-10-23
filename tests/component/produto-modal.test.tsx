import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Modal "Novo Produto" do Estoque.
 *
 * - Embalagem de produto com histórico: o servidor recusa trocar (o histórico
 *   seria relido na unidade nova), então a tela trava o campo e explica.
 * - Estoque inicial pede o custo, com a opção de não cadastrar. Sem a opção,
 *   a entrada valeria R$ 0 e o lucro das primeiras vendas sairia inflado.
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
  it("o card de custos só aparece com estoque inicial, e o custo é obrigatório", async () => {
    const user = userEvent.setup();
    abrir();
    expect(screen.queryByText("Custos desta carga inicial")).toBeNull();

    await user.type(screen.getByLabelText(/Nome do Produto/), "Batata");
    await user.type(screen.getByLabelText("Estoque Inicial"), "10");
    expect(screen.getByText("Custos desta carga inicial")).toBeInTheDocument();
    expect(screen.getByLabelText(/Custo da mercadoria \(R\$ por caixa\)/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salvar Produto" }));
    expect(await screen.findByText(/Informe quanto custou/)).toBeInTheDocument();
    expect(criarProduto).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Custo da mercadoria/), "45,50");
    await user.type(screen.getByLabelText(/Custo de descarregamento/), "1,00");
    expect(screen.getByTestId("custo-carga-unitario")).toHaveTextContent(/46,50/);
    expect(screen.getByTestId("custo-carga-total")).toHaveTextContent(/465,00/);

    await user.click(screen.getByRole("button", { name: "Salvar Produto" }));
    await waitFor(() => expect(criarProduto).toHaveBeenCalledTimes(1));
    expect(criarProduto.mock.calls[0]![0]).toMatchObject({
      name: "Batata",
      saleUnit: "CAIXA",
      estoqueInicial: 10,
      custoInicial: 46.5,
      imageKey: null,
    });
  });

  it("zerar o estoque esconde o card e limpa o custo", async () => {
    const user = userEvent.setup();
    abrir();
    const estoque = screen.getByLabelText("Estoque Inicial");
    await user.type(estoque, "5");
    await user.type(screen.getByLabelText(/Custo da mercadoria/), "10,00");
    await user.clear(estoque);
    expect(screen.queryByText("Custos desta carga inicial")).toBeNull();

    await user.type(screen.getByLabelText(/Nome do Produto/), "Batata");
    await user.click(screen.getByRole("button", { name: "Salvar Produto" }));
    await waitFor(() => expect(criarProduto).toHaveBeenCalledTimes(1));
    expect(criarProduto.mock.calls[0]![0].custoInicial).toBeNull();
  });

  it("dá para gravar o estoque sem custo, e o custo deixa de ser obrigatório", async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByLabelText(/Nome do Produto/), "Uva");
    await user.type(screen.getByLabelText("Estoque Inicial"), "60");
    await user.click(screen.getByRole("checkbox", { name: /Não cadastrar o custo agora/ }));

    expect(screen.queryByLabelText(/Custo da mercadoria/)).toBeNull();
    expect(screen.getByText(/compra seguinte não espalha o preço/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salvar Produto" }));
    await waitFor(() => expect(criarProduto).toHaveBeenCalledTimes(1));
    expect(criarProduto.mock.calls[0]![0]).toMatchObject({
      name: "Uva",
      estoqueInicial: 60,
      custoInicial: null,
      semCustoInicial: true,
    });
  });

  it("Seus produtos: famílias pela primeira palavra e filtro pelo nome digitado", async () => {
    const user = userEvent.setup();
    abrir({
      meusProdutos: [
        { id: "a", name: "Tomate Italiano", saleUnit: "CAIXA", salePrice: 15 },
        { id: "b", name: "Tomate Cereja", saleUnit: "BANDEJA", salePrice: 8 },
        { id: "c", name: "Uva Niágara", saleUnit: "CAIXA", salePrice: null },
      ],
    });
    const lista = screen.getByRole("region", { name: "Seus produtos" });
    expect(lista).toHaveTextContent("TOMATE (2)");
    expect(lista).toHaveTextContent("UVA (1)");

    await user.type(screen.getByLabelText(/Nome do Produto/), "uva");
    expect(screen.getByRole("button", { name: /Uva Niágara/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tomate Italiano/ })).toBeNull();

    await user.clear(screen.getByLabelText(/Nome do Produto/));
    await user.click(screen.getByRole("button", { name: /TOMATE/ }));
    await user.click(screen.getByRole("button", { name: /Tomate Cereja/ }));
    expect(screen.getByLabelText(/Nome do Produto/)).toHaveValue("Tomate Cereja");
    expect(screen.getByLabelText("Embalagem")).toHaveValue("BANDEJA");
  });

  it("sem armazenamento, os botões de foto ficam desabilitados com aviso", () => {
    abrir();
    expect(screen.getByTestId("foto-camera")).toBeDisabled();
    expect(screen.getByTestId("foto-galeria")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Banco/ })).toBeDisabled();
    expect(screen.getByText(/envio de fotos ainda não está disponível/)).toBeInTheDocument();
  });
});
