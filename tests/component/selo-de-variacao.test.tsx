import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeloDeVariacao } from "@/components/data/selo-de-variacao";
import { LIMIAR_DE_ESTABILIDADE } from "@/lib/cotacoes/variacao";

/**
 * O selo de variação — o primeiro teste de componente do repositório.
 *
 * A regra pura (`variacao.ts`) já tinha teste. O que ninguém executava era a
 * TRADUÇÃO dela para a tela: qual cor sai, e se o selo aparece. E é justamente
 * aí que mora a decisão mais fácil de quebrar por engano deste módulo.
 *
 * **Alta é VERMELHA e baixa é VERDE** — o inverso do mercado financeiro, de
 * propósito: para o comerciante do box a cotação é o preço que ele PAGA. Alta é
 * custo subindo; baixa é oportunidade de compra. É o tipo de inversão que um
 * desenvolvedor novo "conserta" numa tarde, achando que é bug, e que nenhum
 * teste apanhava.
 */

/** A cor sai por classe do Tailwind; é assim que ela é verificável aqui. */
const classes = (el: HTMLElement) => el.className;

describe("a cor diz o que aconteceu com o BOLSO de quem compra", () => {
  it("preço subindo é vermelho, porque é custo subindo", () => {
    render(<SeloDeVariacao variacao={18} />);

    const selo = screen.getByText(/18/);
    expect(classes(selo)).toContain("text-destructive");
    expect(classes(selo), "alta não pode sair verde").not.toContain("text-success");
  });

  it("preço caindo é verde, porque é oportunidade de compra", () => {
    render(<SeloDeVariacao variacao={-12} />);

    const selo = screen.getByText(/12/);
    expect(classes(selo)).toContain("text-success");
    expect(classes(selo), "baixa não pode sair vermelha").not.toContain("text-destructive");
  });

  it("estável é neutro — nem alerta, nem comemoração", () => {
    render(<SeloDeVariacao variacao={0.1} />);

    const selo = screen.getByText(/0/);
    expect(classes(selo)).toContain("text-muted-foreground");
  });
});

describe("o sinal de menos não pode quebrar linha", () => {
  it("queda usa o menos tipográfico, e não o hífen", () => {
    /*
      U+2212 (−) e não U+002D (-). O hífen-menos permite quebra de linha depois
      dele: num cartão estreito o sinal ficava sozinho no fim da linha e o
      número descia — e "12%" numa linha nova lê-se como ALTA de 12%, que é o
      oposto exato do que aconteceu com o preço.
    */
    render(<SeloDeVariacao variacao={-12} />);

    const texto = screen.getByText(/12/).textContent ?? "";
    expect(texto).toContain("−");
    expect(texto).not.toContain("-");
  });
});

describe("sem preço anterior, o selo não existe", () => {
  it("variação nula não renderiza nada", () => {
    /*
      "0%" seria MENTIRA, não ausência: um produto que estreou no boletim hoje
      apareceria como preço estável há tempos. O cartão prefere não mostrar
      selo, e o texto do preço anterior explica.
    */
    const { container } = render(<SeloDeVariacao variacao={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("o limiar de estabilidade, visto pela tela", () => {
  it("logo abaixo do limiar ainda é estável", () => {
    // Dois centavos num produto de R$ 5,00 dão 0,4%. Uma tela que grita
    // "subiu!" a cada terceira casa decimal ensina a ignorar a seta — e leva
    // junto a alta de 18% que ela existe para mostrar.
    render(<SeloDeVariacao variacao={LIMIAR_DE_ESTABILIDADE - 0.01} />);
    expect(classes(screen.getByText(/%/))).toContain("text-muted-foreground");
  });

  it("no limiar, já é alta", () => {
    render(<SeloDeVariacao variacao={LIMIAR_DE_ESTABILIDADE} />);
    expect(classes(screen.getByText(/%/))).toContain("text-destructive");
  });
});

describe("o ícone não é lido em voz alta", () => {
  it("a seta é aria-hidden — quem lê a tela já ouve o percentual", () => {
    // Sem isto o leitor de tela anuncia o nome do ícone antes do número, e a
    // informação sai duplicada em toda linha de uma lista de 240 produtos.
    const { container } = render(<SeloDeVariacao variacao={18} />);
    const icone = container.querySelector("svg");

    expect(icone).not.toBeNull();
    expect(icone).toHaveAttribute("aria-hidden", "true");
  });
});
