import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * O formulário abria com a mensalidade do PRIMEIRO plano (o mais barato) e
 * trocar o plano não mexia nela: a empresa nascia no plano caro pagando o
 * barato para sempre — não há tela para corrigir a mensalidade depois.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const criarEmpresa = vi.hoisted(() => vi.fn());
vi.mock("@/actions/admin.actions", () => ({ criarEmpresa }));

const { EmpresaForm } = await import(
  "@/app/(admin)/admin/clientes/novo/_components/empresa-form"
);

const planos = [
  { id: "basico", name: "Básico", priceMonthly: 99 },
  { id: "completo", name: "Completo", priceMonthly: 199 },
];

describe("Nova empresa (super-admin)", () => {
  it("trocar o plano atualiza a mensalidade para o preço dele", async () => {
    const user = userEvent.setup();
    criarEmpresa.mockResolvedValue({ ok: true, data: { tempPassword: "x" } });
    render(<EmpresaForm planos={planos} />);

    await user.type(screen.getByLabelText(/Nome da empresa/), "Box Teste");
    await user.type(screen.getByLabelText("Nome"), "Dono");
    await user.type(screen.getByLabelText("E-mail"), "dono@teste.com");
    await user.selectOptions(screen.getByLabelText("Plano"), "completo");
    await user.click(screen.getByRole("button", { name: /Criar empresa/ }));

    await vi.waitFor(() => expect(criarEmpresa).toHaveBeenCalled());
    expect(criarEmpresa.mock.calls[0][0]).toMatchObject({
      planId: "completo",
      monthlyAmount: 199,
    });
  });

  it("mostra o preço de cada plano na lista", () => {
    render(<EmpresaForm planos={planos} />);
    const opcoes = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opcoes[0]).toMatch(/Básico.*99,00/);
    expect(opcoes[1]).toMatch(/Completo.*199,00/);
  });
});
