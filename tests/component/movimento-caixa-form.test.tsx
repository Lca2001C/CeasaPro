import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { caixaMovimentoTipoEnum } from "@/lib/validations/caixa";

/**
 * O `<select>` de "Movimentar caixas" oferece só o que o servidor aceita.
 *
 * Montado a partir de `CRATE_MOVEMENT_LABELS`, ele oferecia "Estorno de venda
 * cancelada" — que o schema sempre recusa, com um "Verifique os campos
 * destacados" sem campo nenhum destacado — e os movimentos do higienizador,
 * que lançados soltos travavam o lote de higienização para sempre.
 */

const registrar = vi.fn();
vi.mock("@/actions/caixas.actions", () => ({
  registrarMovimentoCaixa: (i: unknown) => registrar(i),
  desfazerEntradaCaixa: vi.fn(),
}));
// `chamarAction` só renova a sessão antes de chamar; aqui chama direto.
vi.mock("@/lib/http/chamar-action", () => ({ chamarAction: (fn: () => unknown) => fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { MovimentoCaixaForm } = await import(
  "@/app/(app)/caixas-plasticas/novo/_components/movimento-form"
);

const saldo = {
  limpas: 10,
  sujas: 0,
  emHigienizacao: 0,
  comClientes: 0,
  perdidas: 0,
  vazias: 10,
};

describe("tipos oferecidos no formulário manual", () => {
  it("são exatamente os do schema do servidor", () => {
    render(<MovimentoCaixaForm saldo={saldo} />);
    const select = screen.getByLabelText("Tipo de movimentação");
    const valores = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(valores).toEqual(caixaMovimentoTipoEnum.options);
    expect(valores).not.toContain("ESTORNO_SAIDA");
    expect(valores).not.toContain("SAIDA_HIGIENIZACAO");
    expect(valores).not.toContain("RETORNO_HIGIENIZACAO");
  });

  it("a perda não pede higienizador — ela se registra no próprio envio", () => {
    render(<MovimentoCaixaForm saldo={saldo} tipoInicial="QUEBRA" />);
    expect(screen.queryByLabelText(/Higienizador/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Higienização" })).toHaveAttribute(
      "href",
      "/higienizacao",
    );
  });
});

/**
 * A entrada de caixas pede o custo de cada uma: a caixa também se vende como
 * embalagem (mesmo estoque) e a venda sai pelo custo médio.
 */
describe("entrada de caixas com custo", () => {
  it("não envia a entrada sem o custo de cada caixa", async () => {
    registrar.mockReset();
    const user = userEvent.setup();
    render(<MovimentoCaixaForm saldo={saldo} tipoInicial="ENTRADA" />);
    await user.type(screen.getByLabelText("Quantidade de caixas"), "10");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(registrar).not.toHaveBeenCalled();
  });

  it("envia o custo junto com a entrada", async () => {
    registrar.mockReset();
    registrar.mockResolvedValue({ ok: true, data: { id: "m1", type: "ENTRADA" } });
    const user = userEvent.setup();
    render(<MovimentoCaixaForm saldo={saldo} tipoInicial="ENTRADA" />);
    await user.type(screen.getByLabelText("Quantidade de caixas"), "10");
    await user.type(screen.getByLabelText("Quanto custou cada caixa (R$)"), "12");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(registrar.mock.calls[0]![0]).toMatchObject({
      type: "ENTRADA",
      quantity: 10,
      unitCost: 12,
    });
  });
});
