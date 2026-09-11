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

  test("as áreas dos módulos opcionais do plano também abrem", async ({ page }) => {
    /*
      Estes são os que dependem do plano, e o plano da empresa demo os inclui.
      Ficavam de fora da varredura: o menu os mostrava e ninguém provava que o
      link leva à tela — um erro de rota num módulo pago só apareceria para o
      cliente que paga por ele.

      Vendas entra aqui pelo mesmo motivo: é o HISTÓRICO (`/vendas`), que não é
      a frente de caixa e não era alcançado por teste nenhum de navegação.
    */
    await page.goto("/dashboard");
    const side = page.locator("aside");

    const opcionais: [string, string][] = [
      ["Vendas", "Vendas"],
      ["Cotações", "Cotações"],
      ["Caixas plásticas", "Caixas plásticas"],
      ["Higienização", "Higienização"],
      // O link diz "Embalagens" e a tela se chama "Venda de embalagens" — é o
      // par que o teste tem de casar, não uma repetição do mesmo texto.
      ["Embalagens", "Venda de embalagens"],
    ];

    for (const [link, heading] of opcionais) {
      await side.getByRole("link", { name: link, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }
  });
});
