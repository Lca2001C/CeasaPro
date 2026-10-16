import { test, expect } from "@playwright/test";

test.describe("Navegação (botões do menu)", () => {
  test("navegar pelas áreas principais pela barra lateral", async ({ page }) => {
    await page.goto("/dashboard");
    const side = page.locator("aside");
    await expect(side).toBeVisible();

    // Produtos e Compras saíram do menu: os dois vivem dentro do Estoque, e a
    // tela se chama "Controle de Estoque" — o par link/título não é o mesmo texto.
    const destinos: [string, string][] = [
      ["Fornecedores", "Fornecedores"],
      ["Despesas", "Despesas"],
      ["Estoque", "Controle de Estoque"],
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
      // Caixas e embalagens são uma tela só, em abas (a demo tem os dois módulos).
      ["Caixas e embalagens", "Caixas e embalagens"],
      ["Higienização", "Higienização"],
    ];

    for (const [link, heading] of opcionais) {
      await side.getByRole("link", { name: link, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }
  });

  test("Caixas e embalagens: a aba fica na URL e o endereço antigo cai nela", async ({ page }) => {
    await page.goto("/caixas-plasticas");
    await page.getByRole("tab", { name: "Embalagens" }).click();
    await expect(page).toHaveURL(/\/caixas-plasticas\?aba=embalagens$/);
    await expect(page.getByRole("tab", { name: "Embalagens" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.getByRole("tab", { name: "Caixas plásticas" }).click();
    await expect(page).toHaveURL(/\/caixas-plasticas$/);

    // Favoritos e o tour antigo apontavam para /embalagens.
    await page.goto("/embalagens");
    await expect(page).toHaveURL(/\/caixas-plasticas\?aba=embalagens$/);
    await expect(page.getByRole("tab", { name: "Embalagens" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
