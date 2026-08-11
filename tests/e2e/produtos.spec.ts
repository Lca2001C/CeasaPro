import { test, expect } from "@playwright/test";

test.describe("Produtos — cadastro, edição e exclusão (dados em 'células')", () => {
  test("criar, editar e excluir um produto", async ({ page }) => {
    const name = `Produto E2E ${Date.now()}`;
    const renamed = `${name} editado`;

    // Criar
    await page.goto("/produtos/novo");
    await page.getByLabel("Nome do produto").fill(name);
    await page.getByLabel("Unidade de venda").selectOption("KG");
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForURL("**/produtos");
    await expect(page.getByText(name)).toBeVisible();

    // Editar
    const row = page.locator("div.rounded-lg", { hasText: name });
    await row.getByRole("link", { name: "Editar" }).click();
    await page.waitForURL(/\/produtos\/[^/]+$/);
    await page.getByLabel("Nome do produto").fill(renamed);
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForURL(/\/produtos$/);
    await expect(page.getByText(renamed)).toBeVisible();

    // Excluir (com diálogo de confirmação)
    const rowRenamed = page.locator("div.rounded-lg", { hasText: renamed });
    await rowRenamed.getByRole("button", { name: "Excluir" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByText(renamed)).toHaveCount(0);
  });
});
