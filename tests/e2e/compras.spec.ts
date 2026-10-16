import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Compra: a entrada de dinheiro e de estoque do box.
 *
 * É o começo do fluxo do CEASA — sem compra não há o que vender —, e era a maior
 * jornada de dinheiro sem prova no browser. A regra fina (rateio do frete,
 * transação, movimento de estoque) já está em `tests/integration/vendas-flow.test.ts`;
 * o que este arquivo prova é a TELA: que os campos gravam o que o usuário
 * digitou, que o efeito aparece onde ele vai conferir, e que a recusa é visível.
 *
 * A tela mora no Estoque (`/estoque/compra`) e a lista é a aba "Compras" dele
 * (`/estoque?aba=compras`). Toda compra vira UMA conta em Despesas, no valor
 * total (itens + frete), paga na hora ou a pagar até um vencimento.
 *
 * Não confundir com `sessao-expirada.spec.ts`, que usa `/estoque/compra` só como
 * um formulário qualquer para exercitar o 401 — lá a compra não é o assunto.
 */

const prisma = new PrismaClient();

const SUFIXO = `${Date.now()}`;
/** Prefixo comum, para a limpeza achar tudo mesmo se uma asserção falhar. */
const MARCA = `E2EC${SUFIXO}`;
const FORNECEDOR = `Fornecedor ${MARCA}`;
/**
 * Produto DEDICADO, e não o `Tomate E2E` do global-setup.
 *
 * O saldo é a asserção central aqui, e o Tomate é vendido por `pdv.spec.ts` no
 * mesmo banco. Um produto só deste arquivo torna a conta exata — 0 antes, 20
 * depois — em vez de uma diferença que depende de quem rodou antes.
 */
const PRODUTO = `Produto ${MARCA}`;

const QUANTIDADE = 20;
const PRECO = 10;
const FRETE = 30;
const TOTAL_ESPERADO = "R$ 230,00"; // 20 × 10 + 30 de frete
/** Descrição que o servidor dá à conta da compra (`ComprasService`). */
const CONTA_COM_FRETE = `Compra — ${FORNECEDOR} (inclui frete R$ 30,00)`;

/** "AAAA-MM-DD" daqui a `dias` dias, no fuso do box — é o que o campo de data espera. */
function diaDaquiA(dias: number): string {
  const alvo = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  // `en-CA` formata como AAAA-MM-DD; o fuso evita a virada de dia do UTC à noite.
  return alvo.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

let tenantId = "";
let productId = "";
let supplierId = "";

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({
    where: { email: "demo@ceasapro.com.br" },
    include: { tenant: true },
  });
  tenantId = owner.tenantId!;

  const p = await prisma.product.create({
    data: { tenantId, name: PRODUTO, saleUnit: "CAIXA", active: true },
  });
  productId = p.id;

  const f = await prisma.supplier.create({
    data: { tenantId, name: FORNECEDOR, active: true },
  });
  supplierId = f.id;
});

test.afterAll(async () => {
  /*
    Ordem ditada pelas chaves estrangeiras, e a despesa vem primeiro de
    propósito: toda compra vira uma conta ligada a ela (`purchaseId`), então
    apagar a compra antes deixaria a despesa órfã — e ela apareceria na tela de
    Despesas da empresa demo para sempre.
  */
  const compras = await prisma.purchase.findMany({
    where: { tenantId, supplierId },
    select: { id: true },
  });
  const ids = compras.map((c) => c.id);
  if (ids.length > 0) {
    await prisma.expense.deleteMany({ where: { tenantId, purchaseId: { in: ids } } });
    await prisma.purchaseItem.deleteMany({ where: { purchaseId: { in: ids } } });
    await prisma.purchase.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.stockMovement.deleteMany({ where: { tenantId, productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.supplier.deleteMany({ where: { id: supplierId } });
  await prisma.$disconnect();
});

test.describe("Compra do CEASA", () => {
  test("registrar compra com frete: entra na lista, sobe o estoque e vira conta paga", async ({
    page,
  }) => {
    await page.goto("/estoque/compra");

    await page.getByLabel("Fornecedor").selectOption({ label: FORNECEDOR });
    await page.getByLabel("Produto do item 1").selectOption({ label: PRODUTO });

    const quantidade = page.getByLabel("Quantidade do item 1");
    await quantidade.fill(String(QUANTIDADE));

    // `fill` num campo de moeda: digitar sobre a máscara depende de onde o
    // cursor parou — a mesma armadilha documentada em `pdv.spec.ts`.
    const preco = page.getByLabel("Preço unitário do item 1");
    await preco.fill(String(PRECO));
    await expect(preco).toHaveValue("R$ 10,00");

    // `exact`: o rótulo é curto e casa por substring com qualquer texto que
    // fale de frete — o campo é este, e só este.
    const frete = page.getByLabel("Frete", { exact: true });
    await frete.fill(String(FRETE));
    await expect(frete).toHaveValue("R$ 30,00");

    // "Pago agora" é o padrão: a conta da compra nasce paga na data da compra.
    await expect(page.getByRole("radio", { name: "Pago agora" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.getByLabel("Forma", { exact: true }).selectOption({ label: "PIX" });

    await page.getByRole("button", { name: "Salvar compra" }).click();

    // Vai para a aba Compras do Estoque, e o efeito está lá: fornecedor, frete,
    // total e a situação da conta.
    await page.waitForURL(/\/estoque\?aba=compras/, { timeout: 15_000 });
    const linha = page.locator("details").filter({ hasText: FORNECEDOR });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText("frete R$ 30,00");
    await expect(linha).toContainText(TOTAL_ESPERADO);
    await expect(linha).toContainText("Paga");

    // O ESTOQUE subiu — é o que a compra existe para fazer.
    await page.goto("/estoque");
    await page.getByLabel("Buscar produto no estoque").fill(PRODUTO);
    const cartao = page.locator('main [data-slot="card"]').filter({ hasText: PRODUTO });
    await expect(cartao).toContainText(String(QUANTIDADE));

    /*
      E a compra virou UMA conta em Despesas, no valor total, com o frete dito
      na descrição.

      É dinheiro que sai do caixa numa tela DIFERENTE da compra, e o vínculo
      entre as duas é justamente o que ninguém confere à mão. Antes só o frete
      virava despesa; agora a conta é a compra inteira (itens + frete), e o
      frete continua rateado no custo do produto — não é cobrado duas vezes.

      Aba "Pagas" e filtro do fornecedor pela URL: Pendentes é o padrão da tela,
      e a conta paga na hora não aparece lá.
    */
    await page.goto(`/despesas?status=PAGO&fornecedor=${supplierId}`);
    const conta = page.locator('main [data-slot="card"]').filter({ hasText: CONTA_COM_FRETE });
    await expect(conta).toBeVisible();
    await expect(conta).toContainText(TOTAL_ESPERADO);
    await expect(conta).toContainText("Pago");
    // O selo "Compra" é o que distingue esta conta de uma despesa operacional.
    await expect(conta.getByText("Compra", { exact: true })).toBeVisible();
  });

  test("compra a pagar: a conta vai para Pendentes com o vencimento escolhido", async ({
    page,
  }) => {
    /*
      O outro lado do bloco Pagamento. Compra no CEASA é muito comprada a prazo
      ("acerto na sexta"), e a conta que não aparece em Pendentes é dívida com
      o fornecedor que ninguém lembra de pagar.

      Sem frete de propósito: a descrição sai sem o "(inclui frete …)" — é o que
      separa esta conta da do teste acima, que é do mesmo fornecedor.
    */
    const vencimento = diaDaquiA(7);

    await page.goto("/estoque/compra");
    await page.getByLabel("Fornecedor").selectOption({ label: FORNECEDOR });
    await page.getByLabel("Produto do item 1").selectOption({ label: PRODUTO });
    await page.getByLabel("Quantidade do item 1").fill("3");
    const preco = page.getByLabel("Preço unitário do item 1");
    await preco.fill("15");
    await expect(preco).toHaveValue("R$ 15,00");

    await page.getByRole("radio", { name: "A pagar" }).click();
    await expect(page.getByRole("radio", { name: "A pagar" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // O campo só existe com "A pagar", e nasce com a data da compra.
    await page.getByLabel("Pagar até").fill(vencimento);

    await page.getByRole("button", { name: "Salvar compra" }).click();

    await page.waitForURL(/\/estoque\?aba=compras/, { timeout: 15_000 });
    const linha = page
      .locator("details")
      .filter({ hasText: FORNECEDOR })
      .filter({ hasText: "A pagar" });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText("R$ 45,00");

    // Pendentes é a aba padrão de Despesas: é lá que a conta a prazo tem de estar.
    await page.goto(`/despesas?fornecedor=${supplierId}`);
    const descricao = page.getByText(`Compra — ${FORNECEDOR}`, { exact: true });
    await expect(descricao).toBeVisible();
    const conta = page.locator('main [data-slot="card"]').filter({ has: descricao });
    await expect(conta).toContainText("R$ 45,00");
    await expect(conta).toContainText("Pendente");
  });

  test("recusa caixas quebradas acima das recebidas, em vez de gravar saldo impossível", async ({
    page,
  }) => {
    /*
      A recusa visível da tela. Caixa plástica é patrimônio do box e o saldo é
      um livro-razão: aceitar "chegaram 5, quebraram 8" gravaria um saldo que
      não existe no mundo, e o erro só apareceria semanas depois, na conferência
      física, sem ninguém saber de onde veio.
    */
    await page.goto("/estoque/compra");

    await page.getByLabel("Produto do item 1").selectOption({ label: PRODUTO });
    await page.getByLabel("Quantidade do item 1").fill("5");
    await page.getByLabel("Preço unitário do item 1").fill("10");

    await page.getByLabel("Chegou em caixa plástica").check();
    await page.getByLabel("Quantas caixas").fill("5");
    await page.getByLabel("Quebradas na chegada").fill("8");

    await page.getByRole("button", { name: "Salvar compra" }).click();

    await expect(page.getByText(/não podem passar do total/i)).toBeVisible();
    // Continua no formulário: nada foi gravado.
    await expect(page).toHaveURL(/\/estoque\/compra/);
  });
});
