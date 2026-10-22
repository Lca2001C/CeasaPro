import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Ajuste de estoque e compra na tela: o que vai para a API.
 *
 * - Acerto de inventário PARA MENOS: a API sempre aceitou `AJUSTE` negativo,
 *   mas a tela só oferecia "Ajuste (entrada)" e o campo não aceita sinal.
 * - Toque duplo: o botão voltava a ficar ativo ANTES da navegação terminar, e
 *   o segundo toque gravava a compra (ou a quebra) de novo.
 */

const apiPost = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiPost: (...a: unknown[]) => apiPost(...a) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
// O "+ Novo produto" da compra abre o modal de produto, que chama Server Actions.
vi.mock("@/actions/produtos.actions", () => ({
  criarProduto: vi.fn(),
  atualizarProduto: vi.fn(),
  enviarFotoProduto: vi.fn(),
  buscarFotosDoBanco: vi.fn(),
}));

const { AjusteForm } = await import("@/app/(app)/estoque/ajuste/_components/ajuste-form");
const { CompraForm } = await import("@/app/(app)/estoque/compra/_components/compra-form");

const produtos = [{ id: "tomate", name: "Tomate" }];

beforeEach(() => {
  apiPost.mockReset();
  push.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
});

describe("ajuste de estoque", () => {
  it("acerto para menos manda AJUSTE com quantidade NEGATIVA", async () => {
    apiPost.mockResolvedValue({ ok: true, data: { id: "m1" } });
    const user = userEvent.setup();
    render(<AjusteForm produtos={produtos} />);
    await user.selectOptions(screen.getByLabelText("Tipo de movimentação"), "AJUSTE_MENOS");
    await user.type(screen.getByLabelText("Quantidade"), "3");
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0]![1]).toMatchObject({
      productId: "tomate",
      type: "AJUSTE",
      quantity: -3,
    });
  });

  it("acerto para mais continua mandando AJUSTE positivo, e quebra continua QUEBRA", async () => {
    apiPost.mockResolvedValue({ ok: false, error: { code: "X", message: "falhou" } });
    const user = userEvent.setup();
    render(<AjusteForm produtos={produtos} />);
    await user.type(screen.getByLabelText("Quantidade"), "2");

    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(apiPost.mock.calls[0]![1]).toMatchObject({ type: "QUEBRA", quantity: 2 });

    await user.selectOptions(screen.getByLabelText("Tipo de movimentação"), "AJUSTE");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(apiPost.mock.calls[1]![1]).toMatchObject({ type: "AJUSTE", quantity: 2 });
  });

  it("depois do sucesso o botão continua travado até a navegação", async () => {
    apiPost.mockResolvedValue({ ok: true, data: { id: "m1" } });
    const user = userEvent.setup();
    render(<AjusteForm produtos={produtos} />);
    await user.type(screen.getByLabelText("Quantidade"), "1");
    const botao = screen.getByRole("button", { name: "Registrar" });
    await user.click(botao);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/estoque"));

    expect(botao).toBeDisabled();
    await user.click(botao);
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it("depois de um erro o botão volta, para corrigir e tentar de novo", async () => {
    apiPost.mockResolvedValue({ ok: false, error: { code: "X", message: "sem estoque" } });
    const user = userEvent.setup();
    render(<AjusteForm produtos={produtos} />);
    await user.type(screen.getByLabelText("Quantidade"), "1");
    const botao = screen.getByRole("button", { name: "Registrar" });
    await user.click(botao);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("sem estoque"));
    expect(botao).toBeEnabled();
  });
});

describe("compra", () => {
  it("toque em 'Salvar compra' depois do sucesso não grava outra compra", async () => {
    apiPost.mockResolvedValue({ ok: true, data: { id: "c1" } });
    const user = userEvent.setup();
    render(<CompraForm produtos={produtos} fornecedores={[]} />);
    const botao = screen.getByRole("button", { name: "Salvar compra" });
    await user.click(botao);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/estoque?aba=compras"));

    // A tela antiga segue na frente até o Estoque chegar: o botão NÃO pode voltar.
    expect(botao).toBeDisabled();
    await user.click(botao);
    await user.click(botao);
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it("depois de um erro o botão volta", async () => {
    apiPost.mockResolvedValue({ ok: false, error: { code: "X", message: "fornecedor" } });
    const user = userEvent.setup();
    render(<CompraForm produtos={produtos} fornecedores={[]} />);
    const botao = screen.getByRole("button", { name: "Salvar compra" });
    await user.click(botao);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("fornecedor"));
    expect(botao).toBeEnabled();
    await user.click(botao);
    expect(apiPost).toHaveBeenCalledTimes(2);
  });
});

describe("compra: pagamento vira a conta em Despesas", () => {
  it("padrão: pago agora, sem forma informada", async () => {
    apiPost.mockResolvedValue({ ok: true, data: { id: "c1" } });
    const user = userEvent.setup();
    render(<CompraForm produtos={produtos} fornecedores={[]} />);
    await user.click(screen.getByRole("button", { name: "Salvar compra" }));
    expect(apiPost.mock.calls[0]![1]).toMatchObject({
      pagamento: { status: "PAGO", paymentMethod: null },
    });
    expect(apiPost.mock.calls[0]![1]).not.toHaveProperty("lancarFreteComoDespesa");
  });

  it("a prazo: manda PENDENTE com o vencimento e a forma", async () => {
    apiPost.mockResolvedValue({ ok: true, data: { id: "c1" } });
    const user = userEvent.setup();
    render(<CompraForm produtos={produtos} fornecedores={[]} />);
    await user.click(screen.getByRole("radio", { name: "A pagar" }));
    await user.selectOptions(screen.getByLabelText("Forma"), "BOLETO");
    const vencimento = screen.getByLabelText("Pagar até") as HTMLInputElement;
    await user.clear(vencimento);
    await user.type(vencimento, "2099-12-31");
    await user.click(screen.getByRole("button", { name: "Salvar compra" }));
    expect(apiPost.mock.calls[0]![1]).toMatchObject({
      pagamento: { status: "PENDENTE", paymentMethod: "BOLETO", dueDate: "2099-12-31" },
    });
  });

  it("a prazo sem vencimento não envia", async () => {
    const user = userEvent.setup();
    render(<CompraForm produtos={produtos} fornecedores={[]} />);
    await user.click(screen.getByRole("radio", { name: "A pagar" }));
    await user.clear(screen.getByLabelText("Pagar até"));
    await user.click(screen.getByRole("button", { name: "Salvar compra" }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Informe até quando vai pagar a compra.");
  });
});

describe("compra: bloco de caixas plásticas segue o módulo", () => {
  it("sem o módulo `caixas`, a tela nem oferece o campo", () => {
    render(<CompraForm produtos={produtos} fornecedores={[]} />);
    expect(screen.queryByLabelText("Chegou em caixa plástica")).toBeNull();
  });

  it("com o módulo, o campo aparece e as caixas vão para a API", async () => {
    apiPost.mockResolvedValue({ ok: true, data: { id: "c1" } });
    const user = userEvent.setup();
    render(<CompraForm produtos={produtos} fornecedores={[]} caixasHabilitado />);
    await user.click(screen.getByLabelText("Chegou em caixa plástica"));
    await user.type(screen.getByLabelText("Quantas caixas"), "12");
    await user.type(screen.getByLabelText("Quanto custou cada caixa (R$)"), "9.5");
    await user.click(screen.getByRole("button", { name: "Salvar compra" }));
    expect(apiPost.mock.calls[0]![1]).toMatchObject({
      caixasRecebidas: 12,
      caixasCustoUnitario: 9.5,
    });
  });

  // A caixa também se vende como embalagem e sai pelo custo médio: sem o custo
  // da entrada, a venda não teria o que descontar do lucro.
  it("com caixas, exige o custo de cada uma antes de enviar", async () => {
    const user = userEvent.setup();
    render(<CompraForm produtos={produtos} fornecedores={[]} caixasHabilitado />);
    await user.click(screen.getByLabelText("Chegou em caixa plástica"));
    await user.type(screen.getByLabelText("Quantas caixas"), "12");
    await user.click(screen.getByRole("button", { name: "Salvar compra" }));
    expect(apiPost).not.toHaveBeenCalled();
  });
});
