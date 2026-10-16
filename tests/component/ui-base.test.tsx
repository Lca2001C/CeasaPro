import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ListaDeAcoes, LinhaDeAcao } from "@/components/ui/linha-de-acao";
import { CardDeResumo } from "@/components/ui/card-de-resumo";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { EmptyState } from "@/components/data/empty-state";

/**
 * Fundação do visual (Fase 1): o que os componentes base PRECISAM continuar
 * fazendo, qualquer que seja a aparência — modal acessível, linha tocável com
 * nome, número sem perder dígito.
 */

function ModalDeTeste() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Abrir conta</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pagar conta</DialogTitle>
          <DialogDescription>Confirme o pagamento.</DialogDescription>
        </DialogHeader>
        <input aria-label="Valor" />
        <DialogFooter>
          <Button>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog (folha no celular, diálogo no desktop)", () => {
  it("abre com título, tem botão Fechar com nome e fecha com Esc devolvendo o foco", async () => {
    const user = userEvent.setup();
    render(<ModalDeTeste />);
    const gatilho = screen.getByRole("button", { name: "Abrir conta" });
    await user.click(gatilho);

    const dialogo = screen.getByRole("dialog", { name: "Pagar conta" });
    expect(dialogo).toBeVisible();
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(gatilho).toHaveFocus();
  });

  it("prende o foco dentro do modal", async () => {
    const user = userEvent.setup();
    render(<ModalDeTeste />);
    await user.click(screen.getByRole("button", { name: "Abrir conta" }));
    const dialogo = screen.getByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialogo.contains(document.activeElement)).toBe(true);
    }
  });

  it("o botão Fechar fecha", async () => {
    const user = userEvent.setup();
    render(<ModalDeTeste />);
    await user.click(screen.getByRole("button", { name: "Abrir conta" }));
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("ListaDeAcoes / LinhaDeAcao", () => {
  it("a linha inteira é o link, com o texto como nome e a seta só decorativa", () => {
    render(
      <ListaDeAcoes titulo="Atalhos">
        <LinhaDeAcao
          href="/despesas"
          icone={<Wallet />}
          titulo="Contas a pagar"
          descricao="2 vencendo"
          complemento="R$ 120,00"
        />
      </ListaDeAcoes>,
    );
    const link = screen.getByRole("link", { name: /Contas a pagar/ });
    expect(link).toHaveAttribute("href", "/despesas");
    expect(link).toHaveTextContent("R$ 120,00");
    expect(screen.getByRole("heading", { name: "Atalhos" })).toBeInTheDocument();
    // Ícone e seta não entram no nome acessível.
    for (const svg of link.querySelectorAll("svg")) {
      expect(svg.closest("[aria-hidden='true']") ?? svg.getAttribute("aria-hidden")).toBeTruthy();
    }
  });

  it("como botão, chama a ação", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <ListaDeAcoes>
        <LinhaDeAcao onClick={onClick} titulo="Trocar tema" semSeta />
      </ListaDeAcoes>,
    );
    await user.click(screen.getByRole("button", { name: "Trocar tema" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("CardDeResumo", () => {
  it("mostra rótulo e o valor inteiro, com dígitos tabulares", () => {
    render(<CardDeResumo rotulo="Hoje vendi" valor="R$ 1.234.567,89" dica="12 vendas" />);
    const valor = screen.getByText("R$ 1.234.567,89");
    expect(valor.className).toMatch(/tabular-nums/);
    expect(screen.getByText("Hoje vendi")).toBeInTheDocument();
    expect(screen.getByText("12 vendas")).toBeInTheDocument();
  });

  it("com href, o cartão todo é o link", () => {
    render(<CardDeResumo rotulo="A receber" valor="R$ 50,00" href="/fiado" />);
    expect(screen.getByRole("link", { name: /A receber/ })).toHaveAttribute("href", "/fiado");
  });
});

describe("EstadoVazio", () => {
  it("explica o que falta e oferece a ação", () => {
    render(
      <EstadoVazio
        titulo="Nenhuma venda hoje"
        descricao="Toque em Nova venda."
        icone={<Inbox />}
        acao={<Button>Nova venda</Button>}
      />,
    );
    expect(screen.getByText("Nenhuma venda hoje")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova venda" })).toBeInTheDocument();
  });

  it("o EmptyState antigo continua funcionando por cima dele", () => {
    render(<EmptyState title="Nada aqui" description="Ainda." />);
    expect(screen.getByText("Nada aqui")).toBeInTheDocument();
    expect(screen.getByText("Ainda.")).toBeInTheDocument();
  });
});
