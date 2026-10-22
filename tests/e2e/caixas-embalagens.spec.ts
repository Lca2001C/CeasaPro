import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Caixa plástica: um estoque só nas abas Caixas e Embalagens.
 *
 * O que se prova pela tela: a caixa que entra pela aba Caixas (com o custo de
 * cada uma) e é vendida pela aba Embalagens sai das LIMPAS — o número do cartão
 * "Limpas (prontas)" cai na mesma quantidade vendida.
 *
 * O tipo "Caixa plástica" da empresa demo é o vinculado (`caixaPlastica`),
 * marcado pela migration `20261027120000_caixas_embalagens_vinculo`.
 */

const prisma = new PrismaClient();

const MARCA = `E2ECE${Date.now()}`;
const CLIENTE = `Cliente ${MARCA}`;
const ENTRADA = 5;
const VENDIDAS = 2;

let tenantId = "";
let tipoNome = "";

/** Lê o número de um cartão de saldo pelo rótulo visível. */
async function saldo(page: import("@playwright/test").Page, rotulo: string): Promise<number> {
  const cartao = page.locator('main [data-slot="card"]').filter({ hasText: rotulo }).first();
  const texto = (await cartao.innerText()).replace(rotulo, "");
  const n = texto.match(/-?\d+/);
  return n ? Number(n[0]) : 0;
}

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({
    where: { email: "demo@ceasapro.com.br" },
    select: { tenantId: true },
  });
  tenantId = owner.tenantId!;
  const tipo = await prisma.packagingType.findFirstOrThrow({
    where: { tenantId, caixaPlastica: true, deletedAt: null },
    select: { name: true },
  });
  tipoNome = tipo.name;
});

test.afterAll(async () => {
  const vendas = await prisma.packagingSale.findMany({
    where: { tenantId, customerName: CLIENTE },
    select: { id: true },
  });
  const vendaIds = vendas.map((v) => v.id);
  const entradas = await prisma.plasticCrateMovement.findMany({
    where: { tenantId, notes: { contains: MARCA } },
    select: { id: true },
  });
  const entradaIds = entradas.map((e) => e.id);
  await prisma.plasticCrateMovement.deleteMany({ where: { packagingSaleId: { in: vendaIds } } });
  await prisma.packagingSale.deleteMany({ where: { id: { in: vendaIds } } });
  await prisma.expense.deleteMany({ where: { plasticCrateMovementId: { in: entradaIds } } });
  await prisma.plasticCrateMovement.deleteMany({ where: { id: { in: entradaIds } } });
  await prisma.$disconnect();
});

test.describe("Caixas e embalagens", () => {
  test("caixa vendida na aba Embalagens sai das limpas da aba Caixas", async ({ page }) => {
    // 1. Entrada de caixas limpas, com o custo de cada uma.
    await page.goto("/caixas-plasticas/novo");
    await page.getByLabel("Tipo de movimentação").selectOption("ENTRADA");
    await page.getByLabel("Quantidade de caixas").fill(String(ENTRADA));
    await page.getByLabel("Quanto custou cada caixa (R$)").fill("12");
    await page.getByLabel("Observações").fill(MARCA);
    await page.getByRole("button", { name: "Registrar" }).click();
    await page.waitForURL(/\/caixas-plasticas$/, { timeout: 15_000 });
    const limpasAntes = await saldo(page, "Limpas (prontas)");

    // 2. Venda da caixa plástica como embalagem.
    await page.goto("/caixas-plasticas?aba=embalagens&nova=1");
    await page.getByLabel("Tipo de embalagem").selectOption({ label: tipoNome });
    await page.getByLabel("Cliente", { exact: true }).fill(CLIENTE);
    await page.getByLabel("Quantidade").fill(String(VENDIDAS));
    await page.getByLabel("Valor unitário").fill("15,00");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // 3. O efeito: as limpas caíram na quantidade vendida.
    await page.goto("/caixas-plasticas");
    await expect.poll(() => saldo(page, "Limpas (prontas)")).toBe(limpasAntes - VENDIDAS);
  });
});
