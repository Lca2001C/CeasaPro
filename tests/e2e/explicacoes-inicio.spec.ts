import { test, expect } from "@playwright/test";

/**
 * "Como é calculado": tocar num número do Início abre a conta dele, e o link
 * de dentro leva à tela de onde os lançamentos vêm.
 */
test.describe("Início: como cada número é calculado", () => {
  test("Visão Geral: o card abre a explicação, e o link leva às vendas", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Hoje vendi: como é calculado" }).click();

    const janela = page.getByRole("dialog");
    await expect(janela.getByRole("heading", { name: "Hoje vendi" })).toBeVisible();
    await expect(janela.getByText("O que entra")).toBeVisible();
    await expect(janela.getByText("O que fica de fora")).toBeVisible();

    await janela.getByRole("link", { name: "Ver as vendas" }).click();
    await page.waitForURL(/\/vendas/);
  });

  test("Sobrou no mês mostra a conta parcela por parcela até o total", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sobrou no mês: como é calculado" }).click();
    const janela = page.getByRole("dialog");
    await expect(janela.getByText("Custo da mercadoria vendida", { exact: true })).toBeVisible();
    await expect(janela.getByText("Contas do mês", { exact: true })).toBeVisible();
    await expect(janela.getByText(/^(Sobrou|Prejuízo)$/)).toBeVisible();
    // O diálogo tem o "X" do canto e o botão grande do rodapé; os dois fecham.
    await janela.getByRole("button", { name: "Fechar" }).last().click();
    await expect(janela).toBeHidden();
  });

  test("Financeiro: cards e gráficos têm a explicação", async ({ page }) => {
    await page.goto("/dashboard?aba=financeiro");
    await page.getByRole("button", { name: "Sobrou em %: como é calculado" }).click();
    await expect(page.getByRole("dialog").getByText(/÷|0%/).first()).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Últimos 6 meses: como é calculado" }).click();
    await expect(page.getByRole("dialog").getByText(/Compras = /)).toBeVisible();
  });
});
