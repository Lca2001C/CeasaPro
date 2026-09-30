import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Falha de TRANSPORTE da Server Action (sinal fraco, ou redirect do proxy para
 * /login) rejeitava a promessa dentro de `startTransition`, e o React mandava
 * o erro para o error boundary: a tela inteira virava "Não conseguimos abrir
 * esta tela" dizendo "seus dados estão salvos" — sem saber se a exclusão foi
 * gravada. O certo é o diálogo continuar aberto com um toast pedindo para
 * conferir.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { DeleteButton } = await import("@/components/crud/delete-button");

beforeEach(() => {
  toast.error.mockReset();
  toast.success.mockReset();
});

describe("DeleteButton", () => {
  it("rede caiu: mostra toast, mantém o diálogo e não derruba a tela", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    render(<DeleteButton action={action} id="p1" entityLabel="o produto Tomate" />);

    await user.click(screen.getByRole("button", { name: "Excluir" }));
    // O primeiro "Excluir" é o ícone; o do diálogo é o último.
    await user.click(screen.getAllByRole("button", { name: "Excluir" }).at(-1)!);

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toMatch(/Falha de conexão/);
    expect(toast.success).not.toHaveBeenCalled();
    // O diálogo segue aberto para a pessoa conferir e tentar de novo.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("sucesso continua fechando o diálogo", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true, data: null });
    render(<DeleteButton action={action} id="p1" entityLabel="o produto Tomate" />);

    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await user.click(screen.getAllByRole("button", { name: "Excluir" }).at(-1)!);

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(action).toHaveBeenCalledWith("p1");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
