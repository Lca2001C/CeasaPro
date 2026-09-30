import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Campo acima do limite (ou CNPJ inválido) reprovava no cliente e NADA
 * aparecia: o onSubmit não rodava, sem toast e sem mensagem no campo. A pessoa
 * achava que tinha salvo, ou que o botão estava quebrado.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const salvarEmpresa = vi.hoisted(() => vi.fn());
vi.mock("@/actions/config.actions", () => ({ salvarEmpresa }));
const salvarFornecedor = vi.hoisted(() => vi.fn());
vi.mock("@/actions/fornecedores.actions", () => ({
  criarFornecedor: salvarFornecedor,
  atualizarFornecedor: salvarFornecedor,
}));

const { EmpresaConfigForm } = await import(
  "@/app/(app)/configuracoes/_components/empresa-form"
);
const { FornecedorForm } = await import("@/app/(app)/fornecedores/_components/fornecedor-form");

beforeEach(() => {
  toast.error.mockReset();
  salvarEmpresa.mockReset();
  salvarFornecedor.mockReset();
});

describe("Configurações > Empresa", () => {
  it("CNPJ com dígito errado mostra a mensagem no campo e avisa", async () => {
    const user = userEvent.setup();
    render(<EmpresaConfigForm initial={{ tradeName: "Box", cnpj: "" }} />);
    await user.type(screen.getByLabelText("CNPJ"), "11.222.333/0001-82");
    await user.click(screen.getByRole("button", { name: /Salvar/ }));

    expect(await screen.findByText(/CNPJ inválido/)).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
    expect(salvarEmpresa).not.toHaveBeenCalled();
  });

  it("horário longo demais também aparece", async () => {
    const user = userEvent.setup();
    render(<EmpresaConfigForm initial={{ tradeName: "Box" }} />);
    await user.click(screen.getByLabelText("Horário de funcionamento"));
    await user.paste("x".repeat(121));
    await user.click(screen.getByRole("button", { name: /Salvar/ }));
    expect(await screen.findByText(/Até 120 caracteres/)).toBeInTheDocument();
  });

  it("CNPJ válido com máscara vai só com os dígitos", async () => {
    const user = userEvent.setup();
    salvarEmpresa.mockResolvedValue({ ok: true, data: null });
    render(<EmpresaConfigForm initial={{ tradeName: "Box" }} />);
    await user.type(screen.getByLabelText("CNPJ"), "11.222.333/0001-81");
    await user.click(screen.getByRole("button", { name: /Salvar/ }));
    await vi.waitFor(() => expect(salvarEmpresa).toHaveBeenCalled());
    expect(salvarEmpresa.mock.calls[0][0].cnpj).toBe("11222333000181");
  });
});

describe("Fornecedor", () => {
  it("observação acima de 500 caracteres mostra a mensagem", async () => {
    const user = userEvent.setup();
    render(<FornecedorForm />);
    await user.type(screen.getByLabelText("Nome"), "Sítio");
    await user.click(screen.getByLabelText("Observações"));
    await user.paste("x".repeat(501));
    await user.click(screen.getByRole("button", { name: /Salvar/ }));
    expect(await screen.findByText(/Até 500 caracteres/)).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
    expect(salvarFornecedor).not.toHaveBeenCalled();
  });
});
