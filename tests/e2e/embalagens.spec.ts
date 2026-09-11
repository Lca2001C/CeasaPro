import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Venda de embalagem — receita avulsa do box.
 *
 * Não passa pelo PDV nem pelo estoque de hortifruti: é a caixa de isopor, a
 * sacaria, o engradado que o cliente leva junto. Entra no faturamento, então
 * errar o total aqui é errar o caixa do dia.
 *
 * O que se prova: o TOTAL é calculado na tela antes de salvar (quantidade ×
 * unitário), e a venda entra no histórico com cliente e valor.
 *
 * O TIPO é criado pelo banco, e não pela tela, porque a tela não oferece esse
 * caminho: `_components/tipo-form.tsx` existe mas não é importado em lugar
 * nenhum, e `criarTipoEmbalagem` só é alcançável por POST direto. Os tipos que
 * uma empresa tem são os que o provisionamento semeia
 * (`DEFAULT_PACKAGING_TYPES`). Testar a criação pela UI seria testar uma jornada
 * que o usuário não tem.
 */

const prisma = new PrismaClient();

const MARCA = `E2EB${Date.now()}`;
const TIPO = `Isopor ${MARCA}`;
const CLIENTE = `Cliente ${MARCA}`;
const QUANTIDADE = 12;
const UNITARIO = "2,50";
const TOTAL = "R$ 30,00";

let tenantId = "";

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({
    where: { email: "demo@ceasapro.com.br" },
    select: { tenantId: true },
  });
  tenantId = owner.tenantId!;
  await prisma.packagingType.create({ data: { tenantId, name: TIPO, active: true } });
});

test.afterAll(async () => {
  const tipos = await prisma.packagingType.findMany({
    where: { tenantId, name: TIPO },
    select: { id: true },
  });
  const ids = tipos.map((t) => t.id);
  await prisma.packagingSale.deleteMany({ where: { packagingTypeId: { in: ids } } });
  await prisma.packagingMovement.deleteMany({ where: { packagingTypeId: { in: ids } } });
  await prisma.packagingType.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test.describe("Embalagens", () => {
  test("vender embalagem: o total fecha na tela e entra no histórico", async ({ page }) => {
    // Venda avulsa. O total aparece ANTES de salvar: 12 × R$ 2,50 = R$ 30,00 —
    // é o número que o operador confere com o cliente antes de fechar.
    await page.goto("/embalagens/nova");
    await page.getByLabel("Tipo de embalagem").selectOption({ label: TIPO });
    await page.getByLabel("Cliente", { exact: true }).fill(CLIENTE);
    await page.getByLabel("Quantidade").fill(String(QUANTIDADE));

    // Vírgula, não ponto: o campo é mascarado em pt-BR, e `fill("2.5")` não
    // produz R$ 2,50. Conferir o valor do campo antes do total ancora a falha
    // no lugar certo se a máscara mudar.
    const unitario = page.getByLabel("Valor unitário");
    await unitario.fill(UNITARIO);
    await expect(unitario).toHaveValue("R$ 2,50");

    await expect(page.getByText(TOTAL).first()).toBeVisible();

    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForURL(/\/embalagens$/, { timeout: 15_000 });

    // 3. O efeito: a venda está no histórico, com cliente e valor.
    const linha = page.locator('main [data-slot="card"]').filter({ hasText: CLIENTE });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText(TOTAL);
  });
});
