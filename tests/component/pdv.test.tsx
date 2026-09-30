import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * A frente de caixa (`/vendas/nova`) na tela: o que o operador vê antes de
 * finalizar. As regras puras estão em `tests/unit/pdv-regras.test.ts`; aqui se
 * confere que a tela as usa.
 */

const apiPost = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiPost: (...a: unknown[]) => apiPost(...a) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const { Pdv } = await import("@/app/(app)/vendas/nova/_components/pdv");

const produtos = [
  { id: "tomate", name: "Tomate", saleUnit: "KG" },
  { id: "limao", name: "Limão Tahiti", saleUnit: "CAIXA" },
];

beforeEach(() => {
  apiPost.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  toast.warning.mockReset();
});

describe("busca", () => {
  it("'limao' acha 'Limão'", async () => {
    const user = userEvent.setup();
    render(<Pdv produtos={produtos} caixasLimpas={0} />);
    await user.type(screen.getByPlaceholderText("Buscar produto..."), "limao");
    expect(screen.getByRole("button", { name: /Limão Tahiti/ })).toBeInTheDocument();
  });
});

describe("linha do carrinho", () => {
  it("mostra o mesmo total que o rodapé e o servidor (2,010 × 1,50 = R$ 3,02)", async () => {
    const user = userEvent.setup();
    render(
      <Pdv
        produtos={produtos}
        caixasLimpas={0}
        produtoInicial="tomate"
        ultimosPrecos={{ tomate: 1.5 }}
        estoquePorProduto={{ tomate: 100 }}
      />,
    );
    const qtd = screen.getByLabelText("Quantidade de Tomate");
    await user.clear(qtd);
    await user.type(qtd, "2,01");
    // Em float, 2.01 * 1.5 = 3.0149999… e a linha mostrava R$ 3,01. Linha e
    // rodapé têm de dizer o mesmo valor que o servidor grava.
    // Linha, rodapé e o "Total da venda" da caixa de troco (Dinheiro é o padrão).
    expect(screen.getAllByText("R$ 3,02")).toHaveLength(3);
    expect(screen.queryByText("R$ 3,01")).not.toBeInTheDocument();
  });
});

describe("troco em pagamento dividido", () => {
  it("compara o recebido com a parte em dinheiro, não com o total", async () => {
    const user = userEvent.setup();
    render(
      <Pdv
        produtos={produtos}
        caixasLimpas={0}
        produtoInicial="limao"
        ultimosPrecos={{ limao: 100 }}
        estoquePorProduto={{ limao: 10 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "PIX" }));
    await user.click(screen.getByRole("button", { name: "Dividir em mais de uma forma" }));

    const primeira = screen.getByLabelText<HTMLInputElement>("Valor da forma de pagamento 1");
    // Substitui o texto inteiro: `clear` zera o campo (R$ 0,00) e o que se
    // digita depois entra atrás dos centavos.
    await user.type(primeira, "60", {
      initialSelectionStart: 0,
      initialSelectionEnd: primeira.value.length,
    });
    expect(primeira).toHaveValue("R$ 60,00");
    await user.click(screen.getByRole("button", { name: /Adicionar forma/ }));
    // A segunda forma nasce com o que falta (R$ 40) — e a próxima livre é Dinheiro.
    expect(screen.getByLabelText("Forma de pagamento 2")).toHaveValue("DINHEIRO");

    expect(screen.getByText("Parte em dinheiro")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Cliente pagou com"), "50");

    const caixa = screen.getByTestId("pdv-troco");
    expect(within(caixa).getByText("Troco")).toBeInTheDocument();
    expect(within(caixa).getByText("R$ 10,00")).toBeInTheDocument();
  });
});

describe("erro do servidor", () => {
  it("mostra a mensagem do campo, não 'Dados inválidos'", async () => {
    apiPost.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Dados inválidos",
        fields: { dueDate: "Data inválida. Use o seletor de data." },
      },
    });
    const user = userEvent.setup();
    render(
      <Pdv
        produtos={produtos}
        caixasLimpas={0}
        produtoInicial="limao"
        ultimosPrecos={{ limao: 10 }}
        estoquePorProduto={{ limao: 10 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Finalizar venda" }));
    expect(toast.error).toHaveBeenCalledWith("Data inválida. Use o seletor de data.");
  });
});

describe("próxima venda", () => {
  it("abre sem o aviso vermelho da venda anterior", async () => {
    apiPost.mockResolvedValue({ ok: true, data: { id: "v1", jaRegistrada: false } });
    const user = userEvent.setup();
    render(
      <Pdv
        produtos={produtos}
        caixasLimpas={0}
        produtoInicial="limao"
        ultimosPrecos={{ limao: 10 }}
        estoquePorProduto={{ limao: 10 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Finalizar venda" }));
    await user.click(await screen.findByRole("button", { name: /Próxima venda/ }));

    expect(screen.getByText("Toque em um produto para adicionar à venda.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("repetir última venda", () => {
  it("deixa de fora o produto que não está mais ativo e avisa", async () => {
    const user = userEvent.setup();
    render(
      <Pdv
        produtos={produtos}
        caixasLimpas={0}
        ultimaVenda={{
          customerName: null,
          itens: [
            { productId: "limao", name: "Limão Tahiti", saleUnit: "CAIXA", quantity: 2, unitPrice: 10 },
            { productId: "alface", name: "Alface", saleUnit: "UNIDADE", quantity: 5, unitPrice: 1 },
          ],
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Repetir última venda/ }));

    expect(screen.getByLabelText("Quantidade de Limão Tahiti")).toBeInTheDocument();
    expect(screen.queryByLabelText("Quantidade de Alface")).not.toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("Alface"));
  });
});

describe("vasilhame sem o módulo de caixas", () => {
  it("não oferece 'Caixa plástica'", async () => {
    const user = userEvent.setup();
    render(
      <Pdv
        produtos={produtos}
        caixasLimpas={0}
        caixasHabilitado={false}
        produtoInicial="limao"
        ultimosPrecos={{ limao: 10 }}
        estoquePorProduto={{ limao: 10 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Vasilhame e desconto/ }));
    const select = screen.getByLabelText("Vasilhame de Limão Tahiti");
    const valores = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(valores).not.toContain("PLASTICA");
    expect(valores).toContain("PAPELAO");
  });
});
