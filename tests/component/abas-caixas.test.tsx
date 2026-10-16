import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AbasCaixasEmbalagens } from "@/app/(app)/caixas-plasticas/_components/abas";

/**
 * Caixas e embalagens: uma tela, duas abas, e os módulos seguem separados no
 * plano — quem tem só um deles recebe só um conteúdo, e aí não há aba nenhuma.
 */

beforeEach(() => {
  window.history.replaceState(null, "", "/caixas-plasticas");
});

describe("AbasCaixasEmbalagens", () => {
  it("com os dois módulos, mostra as duas abas e guarda a escolhida na URL", async () => {
    render(
      <AbasCaixasEmbalagens
        abaInicial="caixas"
        caixas={<p>conteúdo das caixas</p>}
        embalagens={<p>conteúdo das embalagens</p>}
      />,
    );
    expect(screen.getByText("conteúdo das caixas")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Embalagens" }));
    expect(screen.getByText("conteúdo das embalagens")).toBeInTheDocument();
    expect(window.location.search).toBe("?aba=embalagens");

    await userEvent.click(screen.getByRole("tab", { name: "Caixas plásticas" }));
    expect(window.location.search).toBe("");
  });

  it("trocar de aba não reabre a venda que veio aberta por ?nova=1", async () => {
    window.history.replaceState(null, "", "/caixas-plasticas?aba=embalagens&nova=1");
    render(
      <AbasCaixasEmbalagens
        abaInicial="embalagens"
        caixas={<p>caixas</p>}
        embalagens={<p>embalagens</p>}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Caixas plásticas" }));
    await userEvent.click(screen.getByRole("tab", { name: "Embalagens" }));
    expect(window.location.search).toBe("?aba=embalagens");
  });

  it("com um módulo só, não há lista de abas", () => {
    render(<AbasCaixasEmbalagens abaInicial="embalagens" embalagens={<p>só embalagens</p>} />);
    expect(screen.getByText("só embalagens")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});
