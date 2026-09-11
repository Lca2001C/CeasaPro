import { test, expect } from "@playwright/test";

/**
 * Fornecedores — o outro lado do cadastro básico.
 *
 * Espelha `produtos.spec.ts` de propósito: é o mesmo contrato de CRUD (criar,
 * editar, excluir com confirmação) sobre a entidade que a Compra referencia. Sem
 * fornecedor não há de quem comprar, e uma exclusão que derrubasse compras
 * antigas apagaria histórico de dinheiro — por isso a exclusão é soft delete no
 * serviço, e aqui se prova que a tela confirma antes de fazer.
 */

test.describe("Fornecedores — cadastro, edição e exclusão", () => {
  test("criar, editar e excluir um fornecedor", async ({ page }) => {
    const nome = `Fornecedor E2E ${Date.now()}`;
    const renomeado = `${nome} editado`;

    await page.goto("/fornecedores/novo");
    await page.getByLabel("Nome").fill(nome);
    await page.getByLabel("Telefone").fill("31988887777");
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForURL(/\/fornecedores$/);
    await expect(page.getByText(nome)).toBeVisible();

    // Editar pelo lápis da linha — o ícone tem nome acessível ("Editar").
    const linha = page.locator('main [data-slot="card"]').filter({ hasText: nome });
    await linha.getByRole("link", { name: "Editar" }).click();
    await page.waitForURL(/\/fornecedores\/[^/]+$/);
    await page.getByLabel("Nome").fill(renomeado);
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForURL(/\/fornecedores$/);
    await expect(page.getByText(renomeado)).toBeVisible();

    // Excluir exige confirmação: é cadastro que compras antigas referenciam.
    const renomeada = page.locator('main [data-slot="card"]').filter({ hasText: renomeado });
    await renomeada.getByRole("button", { name: "Excluir" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByText(renomeado)).toHaveCount(0);
  });
});
