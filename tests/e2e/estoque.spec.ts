import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Ajuste de estoque — a correção manual do livro-razão.
 *
 * Não existe coluna de saldo: a posição é a soma dos movimentos. O ajuste é como
 * o box registra quebra, doação e conferência física, e é o único caminho em que
 * alguém digita uma quantidade que o sistema não deduziu sozinho.
 *
 * Duas coisas se provam aqui: que a baixa aparece na posição, e que o serviço
 * RECUSA tirar mais do que existe — senão o estoque ficaria negativo, que é um
 * estado que nenhuma tela sabe mostrar e que o inventário nunca fecha.
 */

const prisma = new PrismaClient();

const MARCA = `E2EE${Date.now()}`;
const PRODUTO = `Ajuste ${MARCA}`;
const ESTOQUE = 30;
const QUEBRA = 4;

let tenantId = "";
let productId = "";

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({
    where: { email: "demo@ceasapro.com.br" },
    select: { tenantId: true },
  });
  tenantId = owner.tenantId!;
  const p = await prisma.product.create({
    data: { tenantId, name: PRODUTO, saleUnit: "CAIXA", active: true },
  });
  productId = p.id;
  await prisma.stockMovement.create({
    data: {
      tenantId,
      productId,
      type: "ENTRADA",
      quantity: ESTOQUE,
      unitCost: 8,
      sourceType: "MANUAL",
      reason: "Estoque do teste de ajuste",
    },
  });
});

test.afterAll(async () => {
  await prisma.stockMovement.deleteMany({ where: { tenantId, productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.$disconnect();
});

test.describe("Ajuste de estoque", () => {
  test("registrar quebra baixa a posição do produto", async ({ page }) => {
    await page.goto("/estoque/ajuste");

    await page.getByLabel("Produto").selectOption({ label: PRODUTO });
    await page.getByLabel("Tipo de movimentação").selectOption("QUEBRA");
    await page.getByLabel("Quantidade").fill(String(QUEBRA));
    await page.getByLabel("Motivo").fill("Caixa amassada no transporte");

    await page.getByRole("button", { name: "Registrar" }).click();

    // A posição na tela é o efeito: 30 − 4 = 26.
    await page.waitForURL(/\/estoque$/, { timeout: 15_000 });
    await page.getByLabel("Buscar produto no estoque").fill(PRODUTO);
    const cartao = page.locator('main [data-slot="card"]').filter({ hasText: PRODUTO });
    await expect(cartao).toContainText(String(ESTOQUE - QUEBRA));
  });

  test("recusa baixar mais do que existe, em vez de deixar o saldo negativo", async ({ page }) => {
    await page.goto("/estoque/ajuste");

    await page.getByLabel("Produto").selectOption({ label: PRODUTO });
    await page.getByLabel("Tipo de movimentação").selectOption("QUEBRA");
    await page.getByLabel("Quantidade").fill("9999");

    await page.getByRole("button", { name: "Registrar" }).click();

    // A mensagem diz o saldo real e o efeito — não só "inválido".
    await expect(page.getByText(/deixaria o saldo negativo/i)).toBeVisible();

    // Continua no formulário e a posição não mudou.
    await expect(page).toHaveURL(/\/estoque\/ajuste/);
    await page.goto("/estoque");
    await page.getByLabel("Buscar produto no estoque").fill(PRODUTO);
    await expect(
      page.locator('main [data-slot="card"]').filter({ hasText: PRODUTO }),
    ).toContainText(String(ESTOQUE - QUEBRA));
  });
});
