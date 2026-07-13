import { test, expect } from "@playwright/test";

test.describe("Despesas — valor e seleção de data (calendário)", () => {
  test("lançar uma despesa com data e valor", async ({ page }) => {
    const desc = `Despesa E2E ${Date.now()}`;

    await page.goto("/despesas/nova");
    await page.getByLabel("Descrição").fill(desc);

    // Valor (campo monetário mascarado — único input decimal do formulário)
    const valor = page.locator('input[inputmode="decimal"]');
    await valor.click();
    await valor.pressSequentially("5000"); // R$ 50,00

    await page.getByLabel("Tipo").selectOption("FIXA");
    // Seleção de data (campo de calendário nativo)
    await page.getByLabel("Vencimento").fill("2026-07-20");

    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForURL("**/despesas");

    await expect(page.getByText(desc)).toBeVisible();
  });
});
