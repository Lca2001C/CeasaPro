import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Higienização — o ciclo da caixa suja até o higienizador ser pago.
 *
 * São três estados que o box precisa distinguir: ENVIADO (caixa fora, ainda não
 * voltou), DEVOLVIDO (voltou, mas ainda se deve a lavagem) e PAGO. Confundi-los
 * é pagar duas vezes, ou cobrar uma devolução que já aconteceu.
 *
 * O teste percorre o ciclo inteiro pela tela, incluindo a devolução PARCIAL e a
 * perda — que é o que fecha o lote quando não voltou tudo. Sem a perda, as
 * caixas que sumiram ficariam "aguardando devolução" para sempre.
 */

const prisma = new PrismaClient();

const MARCA = `E2EH${Date.now()}`;
const HIGIENIZADOR = `Lavador ${MARCA}`;
const ENVIADAS = 20;
const DEVOLVIDAS = 15;
const PERDIDAS = 5;
const PRECO_UNITARIO = 1;

let tenantId = "";

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({
    where: { email: "demo@ceasapro.com.br" },
    select: { tenantId: true },
  });
  tenantId = owner.tenantId!;
});

test.afterAll(async () => {
  const lotes = await prisma.crateCleaning.findMany({
    where: { tenantId, cleanerName: HIGIENIZADOR },
    select: { id: true },
  });
  const ids = lotes.map((l) => l.id);
  await prisma.crateCleaningPayment.deleteMany({ where: { cleaningId: { in: ids } } });
  await prisma.crateCleaning.deleteMany({ where: { id: { in: ids } } });
  await prisma.plasticCrateMovement.deleteMany({
    where: {
      tenantId,
      OR: [{ notes: { contains: MARCA } }, { cleanerName: HIGIENIZADOR }],
    },
  });
  await prisma.$disconnect();
});

test.describe("Higienização de caixas", () => {
  test("envio, devolução parcial, perda e pagamento até quitar", async ({ page }) => {
    // 1. O lote precisa de caixas SUJAS em estoque — é o que a higienização
    //    consome. Entram pela mesma tela de movimentação, marcadas como sujas.
    await page.goto("/caixas-plasticas/novo");
    await page.getByLabel("Tipo de movimentação").selectOption("ENTRADA");
    await page.getByLabel("Quantidade de caixas").fill(String(ENVIADAS));
    await page.getByLabel(/chegaram sujas/i).check();
    await page.getByLabel("Observações").fill(MARCA);
    await page.getByRole("button", { name: "Registrar" }).click();
    await page.waitForURL(/\/caixas-plasticas$/, { timeout: 15_000 });

    // 2. Envio para o higienizador.
    await page.goto("/higienizacao/nova");
    await page.getByLabel("Higienizador responsável").fill(HIGIENIZADOR);
    await page.getByLabel("Qtd. enviada").fill(String(ENVIADAS));
    await page.getByLabel("Valor por caixa").fill(String(PRECO_UNITARIO));
    await page.getByRole("button", { name: "Registrar envio" }).click();
    await expect(page.getByText(/Envio registrado/i)).toBeVisible();
    await page.waitForURL(/\/higienizacao$/, { timeout: 15_000 });

    await page.goto("/higienizacao");
    await page.getByRole("link", { name: new RegExp(HIGIENIZADOR) }).first().click();
    await page.waitForURL(/\/higienizacao\/[a-z0-9]+$/i, { timeout: 15_000 });
    await expect(page.getByText("Enviado").first()).toBeVisible();

    // 3. Devolução PARCIAL: voltaram 15 das 20. O lote continua aberto.
    await page.getByLabel("Quantidade devolvida").fill(String(DEVOLVIDAS));
    await page.getByRole("button", { name: "Registrar devolução" }).click();
    await expect(page.getByText(/Devolução registrada/i)).toBeVisible();

    // 4. As 5 que faltam se perderam na lavagem. Sem registrar a perda, o lote
    //    ficaria cobrando para sempre uma devolução que não vem.
    await page.getByLabel("Quantidade perdida").fill(String(PERDIDAS));
    await page.getByRole("button", { name: "Registrar caixas perdidas" }).click();
    await expect(page.getByText(/perdida/i).first()).toBeVisible();

    /*
      5. Pagamento PARCIAL: R$ 10 de R$ 20.

      A asserção é sobre o BLOCO de pagamento continuar na tela — ele só existe
      enquanto há valor a pagar. Procurar a palavra "Pago" não serviria: o
      detalhe tem um campo chamado "Pago" (quanto já foi pago), que existe desde
      o primeiro centavo e não diz nada sobre o lote estar quitado.
    */
    const blocoPagamento = page.getByText("Registrar pagamento ao higienizador");
    await page.getByLabel("Valor pago").fill("10");
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    await expect(page.getByText(/Pagamento registrado/i)).toBeVisible();
    await expect(blocoPagamento).toBeVisible();

    // 6. Quita o restante — e o bloco some, porque não há mais o que pagar.
    await page.getByLabel("Valor pago").fill("10");
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    await expect(page.getByText(/Pagamento registrado/i)).toBeVisible();
    await expect(blocoPagamento).toHaveCount(0);
  });
});
