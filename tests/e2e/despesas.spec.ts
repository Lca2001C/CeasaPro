import { test, expect } from "@playwright/test";

test.describe("Despesas — valor e seleção de data (calendário)", () => {
  test("lançar uma despesa com data e valor", async ({ page }) => {
    const desc = `Despesa E2E ${Date.now()}`;

    await page.goto("/despesas/nova");
    await page.getByLabel("Descrição").fill(desc);

    // Valor (campo monetário mascarado — único input decimal do formulário)
    const valor = page.locator('input[inputmode="decimal"]');
    await valor.click();
    await valor.pressSequentially("5000"); // R$ 5.000,00 (dígitos = reais inteiros)

    await page.getByLabel("Tipo").selectOption("FIXA");
    // Seleção de data (campo de calendário nativo).
    // `exact` evita o checkbox "Repetir todo mês", cujo texto auxiliar também
    // contém a palavra "vencimento" e faz o getByLabel cair em strict-mode.
    await page.getByLabel("Vencimento", { exact: true }).fill("2026-07-20");

    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForURL("**/despesas");

    await expect(page.getByText(desc)).toBeVisible();
  });
});

test.describe("Despesas — lista no celular", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("o card empilha: descrição inteira e Pagar não se sobrepõem", async ({ page }) => {
    const desc = `Frete da compra Transportes Silva ${Date.now()}`;

    await page.goto("/despesas/nova");
    await page.getByLabel("Descrição").fill(desc);
    const valor = page.locator('input[inputmode="decimal"]');
    await valor.click();
    await valor.pressSequentially("100");
    await page.getByLabel("Tipo").selectOption("VARIAVEL");
    await page.getByLabel("Vencimento", { exact: true }).fill("2026-09-02");
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForURL("**/despesas");

    // Pendentes é o padrão; a conta de setembro de 2026 pode estar vencida
    // (hoje é depois disso) — a aba Vencidas também lista.
    if (!(await page.getByText(desc).isVisible().catch(() => false))) {
      await page.getByRole("link", { name: "Vencidas" }).click();
    }

    const titulo = page.getByText(desc);
    await expect(titulo).toBeVisible();
    await expect(titulo).not.toHaveText(/^F\.\.\./);

    // `[data-slot="card"]` e não `.bg-card`: a despesa vencida recebe
    // `bg-destructive/5`, e o tailwind-merge apaga o `bg-card` — o seletor
    // antigo não achava justamente o cartão que este teste cria.
    const card = page.locator('main [data-slot="card"]').filter({ hasText: desc });
    const pagar = card.getByRole("button", { name: "Pagar" });
    await expect(pagar).toBeVisible();

    const boxTitulo = await titulo.boundingBox();
    const boxPagar = await pagar.boundingBox();
    expect(boxTitulo).toBeTruthy();
    expect(boxPagar).toBeTruthy();
    // Empilhados: o botão fica ABAIXO do título, sem cobrir o valor/texto.
    expect(boxPagar!.y).toBeGreaterThan(boxTitulo!.y + boxTitulo!.height - 4);
  });
});
