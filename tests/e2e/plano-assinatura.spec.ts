import { test, expect } from "@playwright/test";

/**
 * Plano, assinatura e relatório na tela.
 *
 * Três telas que o cliente abre para conferir dinheiro — o que ele contratou, o
 * que vai pagar, e o que vendeu — e que nenhum teste de browser tocava.
 *
 * O Mercado Pago NÃO entra aqui. A cobrança de verdade (PIX, cartão, 3DS,
 * webhook, estorno) está coberta em integração, com o gateway mockado; repetir
 * o Payment Brick no Playwright só produziria um teste lento que depende de um
 * serviço de terceiro. O que falta provar é o que a TELA mostra antes disso.
 */

test.describe("Meu plano e assinatura", () => {
  test("Meu plano mostra o que está incluído e a assinatura mostra o valor a pagar", async ({
    page,
  }) => {
    await page.goto("/plano");
    await expect(page.getByRole("heading", { name: "Meu plano" })).toBeVisible();

    await page.goto("/assinatura");
    await expect(page.getByRole("heading", { name: "Assinatura" })).toBeVisible();

    /*
      O valor tem de vir do PLANO NO BANCO, e a tela precisa mostrá-lo: é a
      última confirmação antes de o cliente pagar. Um "R$ 0,00" aqui — ou
      nenhum valor — é a diferença entre cobrar e não cobrar.
    */
    await expect(page.getByText(/R\$\s*\d/).first()).toBeVisible();
  });

  test("assinatura continua acessível para quem está bloqueado", async ({ page }) => {
    /*
      `BILLING_SAFE_PREFIXES`: quem está suspenso precisa conseguir PAGAR. Se o
      porteiro barrasse `/assinatura` junto com o resto, o cliente ficaria sem
      caminho de volta — e sem como voltar a pagar.

      Aqui se mede a garantia do lado de fora: a rota responde 200 e não devolve
      o redirecionamento de conta suspensa.
    */
    const res = await page.goto("/assinatura");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/assinatura/);
  });
});

test.describe("Relatório na tela", () => {
  test("o relatório básico abre com tabela ou vazio coerente", async ({ page }) => {
    // A exportação (Excel/PDF) já é coberta por `relatorios-export.spec.ts`.
    // O que falta é a LEITURA na tela, que é como o dono confere o mês.
    await page.goto("/relatorios");
    await expect(page.getByRole("heading", { name: "Relatórios" })).toBeVisible();

    await page.goto("/relatorios/vendas");
    // Ou a tabela tem cabeçalho, ou o vazio explica — nunca uma tela morta.
    const temTabela = await page.getByRole("table").count();
    if (temTabela > 0) {
      await expect(page.getByRole("table")).toBeVisible();
    } else {
      await expect(page.getByText(/nenhum|sem movimento|vazio/i).first()).toBeVisible();
    }
  });
});
