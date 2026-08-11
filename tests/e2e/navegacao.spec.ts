import { test, expect } from "@playwright/test";

test.describe("Navegação (botões do menu)", () => {
  test("navegar pelas áreas principais pela barra lateral", async ({ page }) => {
    await page.goto("/dashboard");
    const side = page.locator("aside");
    await expect(side).toBeVisible();

    const destinos: [string, string][] = [
      ["Produtos", "Produtos"],
      ["Fornecedores", "Fornecedores"],
      ["Compras", "Compras"],
      ["Despesas", "Despesas"],
      ["Estoque", "Estoque"],
      ["Fiado", "Fiado"],
      ["Relatórios", "Relatórios"],
      ["Meu plano", "Meu plano"],
      ["Configurações", "Configurações"],
    ];

    for (const [link, heading] of destinos) {
      await side.getByRole("link", { name: link, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }
  });
});
