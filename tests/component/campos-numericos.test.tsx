import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { CurrencyInput } from "@/components/forms/currency-input";
import { QuantityInput } from "@/components/forms/quantity-input";
import { Label } from "@/components/ui/label";

/**
 * Os dois campos por onde entram DINHEIRO e QUANTIDADE.
 *
 * São o contrato de entrada de umas quinze telas — PDV, compra, fiado, despesa,
 * ajuste de estoque, produto. Se um deles emitir o número errado, o erro não
 * aparece na tela: aparece no estoque, no fiado e no faturamento, dias depois,
 * como divergência que ninguém sabe explicar.
 *
 * Até esta auditoria nada os exercitava: a lógica deles é toda de interação
 * (digitar, formatar, emitir), e não havia como testar interação — `jsdom` e
 * `@testing-library/react` não estavam instalados.
 *
 * O que se afirma aqui é o VALOR EMITIDO, não a máscara. A máscara é da
 * `react-number-format`, que tem os próprios testes; o que é nosso — e o que
 * quebra o banco de dados quando erra — é o número que sai no `onChange`.
 */

/** Envolve o campo em estado real: é assim que as telas o usam. */
function CampoMoeda({ aoMudar }: { aoMudar: (v: number | undefined) => void }) {
  const [valor, setValor] = useState<number | undefined>(undefined);
  return (
    <CurrencyInput
      aria-label="Valor"
      value={valor}
      onChange={(v) => {
        setValor(v);
        aoMudar(v);
      }}
    />
  );
}

function CampoQuantidade({
  aoMudar,
  sufixo,
}: {
  aoMudar: (v: number | undefined) => void;
  sufixo?: string;
}) {
  const [valor, setValor] = useState<number | undefined>(undefined);
  return (
    <QuantityInput
      aria-label="Quantidade"
      suffix={sufixo}
      value={valor}
      onChange={(v) => {
        setValor(v);
        aoMudar(v);
      }}
    />
  );
}

describe("o campo de moeda emite REAIS, não centavos", () => {
  it("os dígitos vão para os REAIS — não é máscara de centavos", async () => {
    /*
      Este é o contrato de verdade, e ele surpreende: digitar "1234" dá
      R$ 1.234,00, e NÃO R$ 12,34. O campo tem `decimalScale={2}` com
      `fixedDecimalScale`, então os centavos só mudam quando se digita a
      vírgula.

      Fica preso aqui porque as duas convenções existem no mercado e a
      diferença é de cem vezes. Muito PDV usa a máscara "centavos primeiro"
      (digitar 1234 vira R$ 12,34, sem tocar na vírgula), e quem vier deste
      hábito vai achar que o campo está quebrado. Se algum dia a decisão mudar,
      que mude com este teste falhando e alguém escolhendo — não por acidente
      num ajuste de `decimalScale`, que multiplicaria ou dividiria por 100 todo
      preço digitado no sistema.
    */
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    render(<CampoMoeda aoMudar={aoMudar} />);

    const campo = screen.getByLabelText("Valor");
    await user.type(campo, "1234");

    expect(campo).toHaveValue("R$ 1.234,00");
    expect(aoMudar).toHaveBeenLastCalledWith(1234);
  });

  it("a vírgula é o que abre os centavos", async () => {
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    render(<CampoMoeda aoMudar={aoMudar} />);

    const campo = screen.getByLabelText("Valor");
    await user.type(campo, "12,34");

    expect(campo).toHaveValue("R$ 12,34");
    expect(aoMudar).toHaveBeenLastCalledWith(12.34);
  });

  it("usa vírgula decimal e ponto de milhar, como se escreve aqui", async () => {
    // Separadores do português do Brasil. Invertidos, "R$ 1,234.56" seria lido
    // como um real e pouco por quem confere a tela.
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    render(<CampoMoeda aoMudar={aoMudar} />);

    await user.type(screen.getByLabelText("Valor"), "1234,56");

    expect(screen.getByLabelText("Valor")).toHaveValue("R$ 1.234,56");
    expect(aoMudar).toHaveBeenLastCalledWith(1234.56);
  });

  it("não aceita valor negativo", async () => {
    // Preço negativo não existe no balcão, e chegaria ao banco como crédito.
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    render(<CampoMoeda aoMudar={aoMudar} />);

    await user.type(screen.getByLabelText("Valor"), "-500");

    expect(screen.getByLabelText("Valor")).not.toHaveValue(expect.stringContaining("-"));
    for (const chamada of aoMudar.mock.calls) {
      if (typeof chamada[0] === "number") expect(chamada[0]).toBeGreaterThanOrEqual(0);
    }
  });

  it("campo vazio emite indefinido, e não zero", async () => {
    /*
      A diferença entre "não informei" e "é zero" é o que separa um campo
      opcional em branco de um desconto de R$ 0,00 gravado de propósito. Zero
      aqui faria o formulário tratar ausência como valor.
    */
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    render(<CampoMoeda aoMudar={aoMudar} />);

    const campo = screen.getByLabelText("Valor");
    await user.type(campo, "50");
    await user.clear(campo);

    expect(aoMudar).toHaveBeenLastCalledWith(undefined);
  });
});

describe("o campo de quantidade aceita fração, porque quilo tem", () => {
  it("guarda até três casas decimais", async () => {
    // Venda por quilo: 1,255 kg é uma pesagem comum. Arredondar para duas casas
    // perderia grama em toda venda, e a diferença aparece no fechamento.
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    render(<CampoQuantidade aoMudar={aoMudar} />);

    await user.type(screen.getByLabelText("Quantidade"), "1,255");

    expect(aoMudar).toHaveBeenLastCalledWith(1.255);
  });

  it("o sufixo é só aparência — o valor emitido continua número", async () => {
    /*
      O sufixo (" kg") entra no texto do campo. Se ele vazasse para o valor, o
      formulário receberia string e o Zod recusaria com uma mensagem que não
      diz nada sobre o que a pessoa digitou.
    */
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    render(<CampoQuantidade aoMudar={aoMudar} sufixo="kg" />);

    const campo = screen.getByLabelText("Quantidade");
    await user.type(campo, "12");

    expect(campo).toHaveValue("12 kg");
    expect(aoMudar).toHaveBeenLastCalledWith(12);
  });

  it("não aceita quantidade negativa", async () => {
    const aoMudar = vi.fn();
    const user = userEvent.setup();
    render(<CampoQuantidade aoMudar={aoMudar} />);

    await user.type(screen.getByLabelText("Quantidade"), "-3");

    for (const chamada of aoMudar.mock.calls) {
      if (typeof chamada[0] === "number") expect(chamada[0]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("os dois jeitos de dar nome ao campo", () => {
  /*
    Esta auditoria dependeu dos dois, e por isso eles ficam presos aqui.

    Em formulário de campo único vale `htmlFor` + `id`, que além do nome dá o
    toque no rótulo para focar o campo. Em lista repetida (itens de uma compra)
    `id` colidiria entre as linhas, e o nome vem por `aria-label` com o número
    do item.
  */

  it("aria-label dá nome ao campo quando o rótulo é um texto solto", () => {
    render(<CurrencyInput aria-label="Preço unitário do item 3" value={5} onChange={() => {}} />);
    expect(screen.getByLabelText("Preço unitário do item 3")).toBeInTheDocument();
  });

  it("id + htmlFor associam rótulo e campo, e tocar no rótulo foca o campo", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Label htmlFor="freight">Frete</Label>
        <CurrencyInput id="freight" value={0} onChange={() => {}} />
      </>,
    );

    const campo = screen.getByLabelText("Frete");
    expect(campo).toBeInTheDocument();

    await user.click(screen.getByText("Frete"));
    expect(campo).toHaveFocus();
  });

  it("sem nenhum dos dois, o campo fica SEM nome — que era o defeito", () => {
    /*
      A demonstração do que o axe acusava como crítico em cinco telas: o rótulo
      estava na tela, mas solto, e o campo não tinha nome nenhum. Este caso
      falha no dia em que alguém der um nome padrão ao componente — e aí a
      conversa é sobre remover as associações explícitas, não sobre "consertar
      o teste".
    */
    render(<CurrencyInput value={0} onChange={() => {}} />);
    expect(screen.queryByLabelText(/./)).toBeNull();
  });
});
