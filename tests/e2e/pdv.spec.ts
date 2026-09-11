import { test, expect } from "@playwright/test";

/** Produto criado pelo `global-setup` (unidade CAIXA, com estoque). */
const PRODUTO = "Tomate E2E";

test.describe("Frente de caixa (PDV) — carrinho e botões", () => {
  test("adicionar item, ajustar quantidade, definir preço e finalizar", async ({ page }) => {
    await page.goto("/vendas/nova");

    // Buscar e adicionar o produto ao carrinho
    await page.getByPlaceholder("Buscar produto...").fill(PRODUTO);
    await page.getByRole("button", { name: new RegExp(PRODUTO) }).first().click();

    // Aumentar a quantidade para 2.
    //
    // A quantidade é um CAMPO, não texto: ± serve para 1 ou 2, mas não para 40,
    // então ela também é digitável. Por isso a asserção é sobre o valor do
    // campo — e o campo é alcançado pelo nome acessível, não por índice na
    // página (o PDV tem vários campos numéricos: quantidade ao adicionar,
    // quantidade do item, preço, desconto e troco).
    const quantidade = page.getByLabel(`Quantidade de ${PRODUTO}`);
    await expect(quantidade).toHaveValue("1");
    await page.getByRole("button", { name: "Aumentar quantidade" }).click();
    await expect(quantidade).toHaveValue("2");

    // Definir o preço unitário.
    //
    // `fill` e não `pressSequentially`: o campo já nasce preenchido (o último
    // preço praticado, ou "R$ 0,00" para produto nunca vendido) e digitar sobre
    // uma máscara de moeda depende de onde o cursor parou — o mesmo teste dava
    // R$ 10,00 no banco limpo e R$ 100,00 depois de já existir uma venda.
    const preco = page.getByLabel(`Preço de ${PRODUTO}`);
    await preco.fill("10");
    await expect(preco).toHaveValue("R$ 10,00");

    // Total da venda visível antes de finalizar: 2 × R$ 10,00
    await expect(page.getByText("R$ 20,00").first()).toBeVisible();

    // Botões da barra: forma de pagamento + finalizar
    await page.getByRole("button", { name: "Dinheiro" }).click();
    await page.getByRole("button", { name: "Finalizar venda" }).click();

    await expect(page.getByText(/Venda registrada/i)).toBeVisible();

    // A venda aparece no histórico
    await page.goto("/vendas");
    await expect(page.getByText(/Cliente|Dinheiro/).first()).toBeVisible();
  });

  test("digitar a quantidade antes de adicionar evita 40 toques no +", async ({ page }) => {
    await page.goto("/vendas/nova");

    // O campo ao lado da busca define a quantidade usada ao tocar no produto.
    const qtdAoAdicionar = page.getByLabel("Quantidade ao adicionar");
    await qtdAoAdicionar.fill("");
    await qtdAoAdicionar.pressSequentially("40");

    await page.getByPlaceholder("Buscar produto...").fill(PRODUTO);
    await page.getByRole("button", { name: new RegExp(PRODUTO) }).first().click();

    await expect(page.getByLabel(`Quantidade de ${PRODUTO}`)).toHaveValue("40");
  });

  test("desconto no item e pagamento em duas formas fecham a conta", async ({ page }) => {
    /*
      Os dois casos que o balcão usa junto e que a venda simples não cobre:
      "faz por R$ 90" (desconto na linha) e "metade no dinheiro, metade no PIX".

      O que se mede é a ARITMÉTICA QUE O OPERADOR VÊ antes de apertar finalizar —
      o total da barra depois do desconto, e a soma das formas fechando com ele.
      Errar aqui é fechar a venda com valor diferente do combinado, com o cliente
      na frente. As somas em centavos estão em `tests/unit/venda-total.test.ts`;
      aqui é a tela.
    */
    await page.goto("/vendas/nova");

    await page.getByPlaceholder("Buscar produto...").fill(PRODUTO);
    await page.getByRole("button", { name: new RegExp(PRODUTO) }).first().click();

    await page.getByLabel(`Quantidade de ${PRODUTO}`).fill("2");
    await page.getByLabel(`Preço de ${PRODUTO}`).fill("50");
    await expect(page.getByText("R$ 100,00").first()).toBeVisible();

    // Desconto de R$ 10 na linha: 2 × 50 − 10 = 90.
    await page.getByRole("button", { name: /Vasilhame e desconto/ }).click();
    await page.getByLabel(`Desconto de ${PRODUTO}`).fill("10");
    await expect(page.getByText("R$ 90,00").first()).toBeVisible();

    // Divide em duas formas. A primeira já vem com o total; tira-se um pedaço.
    await page.getByRole("button", { name: "Dividir em mais de uma forma" }).click();
    const primeiro = page.getByLabel("Valor da forma de pagamento 1");
    await expect(primeiro).toHaveValue("R$ 90,00");
    await primeiro.fill("40");

    /*
      A segunda forma já nasce com o RESTO preenchido e com a próxima forma
      ainda não usada — dividir é "tirar um pedaço", não remontar a conta.
    */
    await page.getByRole("button", { name: "Adicionar forma" }).click();
    // `exact`: "Valor da forma de pagamento 2" contém este nome por substring.
    await page.getByLabel("Forma de pagamento 2", { exact: true }).selectOption("PIX");
    const segundo = page.getByLabel("Valor da forma de pagamento 2");
    await expect(segundo).toHaveValue("R$ 50,00");
    await expect(page.getByText("Fecha com o total")).toBeVisible();

    // Erra o valor de propósito: a tela tem de dizer QUANTO falta, senão a venda
    // fecharia por um valor diferente do combinado com o cliente.
    await segundo.fill("10");
    await expect(page.getByText(/^Falta/)).toBeVisible();

    await segundo.fill("50");
    await expect(page.getByText("Fecha com o total")).toBeVisible();

    await page.getByRole("button", { name: "Finalizar venda" }).click();
    await expect(page.getByText(/Venda registrada/i)).toBeVisible();
  });

  test("item sem preço pede confirmação em vez de registrar venda zerada", async ({ page }) => {
    await page.goto("/vendas/nova");

    await page.getByPlaceholder("Buscar produto...").fill(PRODUTO);
    await page.getByRole("button", { name: new RegExp(PRODUTO) }).first().click();

    // Zera o preço sugerido, se houver: o caso é "produto sem preço".
    const preco = page.getByLabel(`Preço de ${PRODUTO}`);
    await preco.fill("");

    await page.getByRole("button", { name: "Finalizar venda" }).click();

    // Bloqueia e explica o efeito, em vez de deixar passar em silêncio.
    await expect(
      page.getByRole("heading", { name: /Registrar venda com item sem preço/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Voltar e corrigir" }).click();
    await expect(page.getByRole("button", { name: "Finalizar venda" })).toBeVisible();
  });
});
