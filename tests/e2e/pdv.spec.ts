import { test, expect } from "@playwright/test";

test.describe("Frente de caixa (PDV) — carrinho e botões", () => {
  test("adicionar item, ajustar quantidade, definir preço e finalizar", async ({ page }) => {
    await page.goto("/vendas/nova");

    // Buscar e adicionar o produto ao carrinho
    await page.getByPlaceholder("Buscar produto...").fill("Tomate E2E");
    await page.getByRole("button", { name: /Tomate E2E/ }).first().click();

    // "Editar célula": aumentar a quantidade para 2
    await page.getByRole("button", { name: "Aumentar quantidade" }).click();
    await expect(page.getByText("2", { exact: true })).toBeVisible();

    // Definir o preço unitário (campo monetário do carrinho)
    const preco = page.locator('input[inputmode="decimal"]').first();
    await preco.click();
    await preco.pressSequentially("1000"); // R$ 10,00

    // Botões da barra: forma de pagamento + finalizar
    await page.getByRole("button", { name: "Dinheiro" }).click();
    await page.getByRole("button", { name: "Finalizar venda" }).click();

    await expect(page.getByText(/Venda registrada/i)).toBeVisible();

    // A venda aparece no histórico
    await page.goto("/vendas");
    await expect(page.getByText(/Cliente|Dinheiro/).first()).toBeVisible();
  });
});
