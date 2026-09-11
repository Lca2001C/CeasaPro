import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * PDV na forma FIADO — a venda que não entra no caixa hoje.
 *
 * `pdv.spec.ts` cobre a venda em dinheiro. O fiado é outro desfecho: a venda
 * baixa o estoque como qualquer outra, mas em vez de dinheiro ela cria uma CONTA
 * A RECEBER, com nome de cliente e saldo. Errar aqui é o box entregar mercadoria
 * e não ter registro de quem deve.
 *
 * A regra (transação, saldo, bloqueio) está em `tests/integration/vendas-flow.test.ts`.
 * Aqui se prova a tela: que a forma Fiado exige cliente, que a conta aparece em
 * `/fiado` com o valor certo, e que vender mais do que existe é RECUSADO com
 * mensagem — não aceito em silêncio.
 */

const prisma = new PrismaClient();

const SUFIXO = `${Date.now()}`;
const MARCA = `E2EF${SUFIXO}`;
const PRODUTO = `Fiado ${MARCA}`;
const CLIENTE = `Cliente ${MARCA}`;

/** Estoque inicial do produto deste arquivo. */
const ESTOQUE = 10;
const QUANTIDADE = 2;
const PRECO = 25;
const TOTAL = "R$ 50,00";

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

  // Estoque pelo LIVRO-RAZÃO, como o resto do sistema faz: não existe coluna de
  // saldo para preencher.
  await prisma.stockMovement.create({
    data: {
      tenantId,
      productId,
      type: "ENTRADA",
      quantity: ESTOQUE,
      unitCost: 10,
      sourceType: "MANUAL",
      reason: "Estoque do teste de fiado",
    },
  });
});

test.afterAll(async () => {
  const contas = await prisma.creditAccount.findMany({
    where: { tenantId, customerName: CLIENTE },
    select: { id: true, saleId: true },
  });
  await prisma.creditPayment.deleteMany({
    where: { accountId: { in: contas.map((c) => c.id) } },
  });
  await prisma.creditAccount.deleteMany({ where: { id: { in: contas.map((c) => c.id) } } });

  const vendas = await prisma.sale.findMany({
    where: { tenantId, items: { some: { productId } } },
    select: { id: true },
  });
  const ids = vendas.map((v) => v.id);
  await prisma.salePayment.deleteMany({ where: { saleId: { in: ids } } });
  await prisma.saleItem.deleteMany({ where: { saleId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { id: { in: ids } } });

  await prisma.stockMovement.deleteMany({ where: { tenantId, productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.$disconnect();
});

test.describe("Venda fiada no balcão", () => {
  test("vender no fiado cria a conta a receber com o saldo do total", async ({ page }) => {
    await page.goto("/vendas/nova");

    await page.getByPlaceholder("Buscar produto...").fill(PRODUTO);
    await page.getByRole("button", { name: new RegExp(PRODUTO) }).first().click();

    const quantidade = page.getByLabel(`Quantidade de ${PRODUTO}`);
    await quantidade.fill(String(QUANTIDADE));

    const preco = page.getByLabel(`Preço de ${PRODUTO}`);
    await preco.fill(String(PRECO));
    await expect(preco).toHaveValue("R$ 25,00");

    // `exact`: o nome do produto deste teste começa com "Fiado", então o botão
    // "Remover Fiado …" do carrinho também casa por substring.
    await page.getByRole("button", { name: "Fiado", exact: true }).click();

    /*
      Sem cliente, a tela avisa ANTES de deixar finalizar — a parte fiada precisa
      de nome para virar conta a receber. É o aviso que impede a venda anônima
      que ninguém consegue cobrar depois.
    */
    await expect(page.getByText(/a parte fiada precisa de nome/i)).toBeVisible();

    await page.getByLabel("Cliente (opcional)").fill(CLIENTE);
    await expect(page.getByText(/a parte fiada precisa de nome/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Finalizar venda" }).click();
    await expect(page.getByText(/Venda registrada/i)).toBeVisible();

    // O efeito: a conta existe, com o nome do cliente e o saldo igual ao total.
    await page.goto("/fiado");
    const linha = page.getByRole("row").filter({ hasText: CLIENTE });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText(TOTAL);
  });

  test("recusa vender mais do que existe em estoque, com o número na tela", async ({ page }) => {
    await page.goto("/vendas/nova");

    await page.getByPlaceholder("Buscar produto...").fill(PRODUTO);
    await page.getByRole("button", { name: new RegExp(PRODUTO) }).first().click();

    // Muito acima do que entrou (10) e do que já saiu (2) no teste anterior.
    await page.getByLabel(`Quantidade de ${PRODUTO}`).fill("999");
    await page.getByLabel(`Preço de ${PRODUTO}`).fill("5");

    /*
      Dois níveis de recusa, e os dois importam.

      O aviso na tela evita que o operador descubra a falta com o cliente na
      frente, depois de já ter fechado o valor. Mas ele é só aviso: a barreira
      real é o servidor, e é ela que este teste faz disparar — porque é a que
      continua valendo se alguém mexer no cálculo do browser.
    */
    await expect(page.getByText(/só tem/i).first()).toBeVisible();

    await page.getByRole("button", { name: "Finalizar venda" }).click();
    await expect(page.getByText(/Estoque insuficiente/i)).toBeVisible();

    // Continua na frente de caixa, com o carrinho intacto: nada foi gravado.
    await expect(page).toHaveURL(/\/vendas\/nova/);
    await expect(page.getByRole("button", { name: "Finalizar venda" })).toBeVisible();
  });
});
