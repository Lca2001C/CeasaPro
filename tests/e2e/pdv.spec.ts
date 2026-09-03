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
