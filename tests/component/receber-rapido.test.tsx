import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * "Receber" rápido da lista do fiado.
 *
 * No celular o componente mora DENTRO do `<Link href=/fiado/{id}>` do card. O
 * diálogo vai para um portal, mas eventos sintéticos do React sobem pela árvore
 * de componentes, portal incluído — então qualquer toque no diálogo chegava ao
 * onClick do Link, que navegava para o detalhe no meio do recebimento.
 *
 * O `<div onClick>` abaixo faz o papel do Link: é exatamente o handler que o
 * Next chama (`linkClicked` → navegação) quando o clique chega até ele.
 */

const apiPost = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiPost: (...a: unknown[]) => apiPost(...a) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ReceberRapido } = await import("@/app/(app)/fiado/_components/receber-rapido");

const linkDoCard = vi.fn();

function montar() {
  render(
    <div onClick={linkDoCard}>
      <ReceberRapido accountId="conta-1" customerName="João" saldo={100} />
    </div>,
  );
}

beforeEach(() => {
  apiPost.mockReset();
  linkDoCard.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
});

describe("ReceberRapido dentro do link do card", () => {
  it("abrir o diálogo não navega", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: /Receber/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(linkDoCard).not.toHaveBeenCalled();
  });

  it("mexer no valor e na forma não navega (pagamento parcial em PIX)", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: /Receber/ }));
    const dialogo = screen.getByRole("dialog");

    const valor = within(dialogo).getByLabelText("Valor recebido");
    await user.click(valor);
    await user.clear(valor);
    await user.type(valor, "40");
    await user.selectOptions(within(dialogo).getByLabelText("Forma de recebimento"), "PIX");

    expect(linkDoCard).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Cancelar fecha sem navegar", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: /Receber/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(linkDoCard).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Confirmar registra o pagamento e não navega", async () => {
    apiPost.mockResolvedValue({ ok: true, data: {} });
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: /Receber/ }));
    const dialogo = screen.getByRole("dialog");
    await user.selectOptions(within(dialogo).getByLabelText("Forma de recebimento"), "PIX");
    await user.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    expect(apiPost).toHaveBeenCalledWith("/api/fiado/pagamento", {
      accountId: "conta-1",
      amount: 100,
      method: "PIX",
    });
    expect(linkDoCard).not.toHaveBeenCalled();
  });
});
