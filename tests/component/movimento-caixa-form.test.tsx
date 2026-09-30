import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { caixaMovimentoTipoEnum } from "@/lib/validations/caixa";

/**
 * O `<select>` de "Movimentar caixas" oferece só o que o servidor aceita.
 *
 * Montado a partir de `CRATE_MOVEMENT_LABELS`, ele oferecia "Estorno de venda
 * cancelada" — que o schema sempre recusa, com um "Verifique os campos
 * destacados" sem campo nenhum destacado — e os movimentos do higienizador,
 * que lançados soltos travavam o lote de higienização para sempre.
 */

vi.mock("@/actions/caixas.actions", () => ({ registrarMovimentoCaixa: vi.fn() }));
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
