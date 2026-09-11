import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Fiado: receber o que já foi entregue.
 *
 * É a jornada em que o box tem dinheiro na rua. `pdv-fiado.spec.ts` prova a
 * CRIAÇÃO da conta pelo balcão; aqui se prova o resto do ciclo — receber em
 * partes, quitar, e as duas recusas que protegem dinheiro: não deixar pagar mais
 * do que se deve, e não deixar apagar uma conta que já recebeu.
 *
 * A aritmética do saldo e a concorrência de dois pagamentos simultâneos estão em
 * `tests/integration/fiado-crud.test.ts`. Aqui o que se mede é o que o dono do
 * box vê: o número na linha muda, a conta troca de aba, o erro aparece.
 */

const prisma = new PrismaClient();

const SUFIXO = `${Date.now()}`;
const MARCA = `E2ER${SUFIXO}`;
const PRODUTO = `Receber ${MARCA}`;

const ESTOQUE = 50;
const QTD = 4;
const PRECO = 25;
const TOTAL = "R$ 100,00";

let tenantId = "";
let productId = "";

/** Nome por teste: cada um abre a própria conta e não depende da ordem. */
const cliente = (qual: string) => `Cliente ${qual} ${MARCA}`;

async function saldoEmEstoque(): Promise<number> {
  const movs = await prisma.stockMovement.groupBy({
    by: ["type"],
    where: { tenantId, productId },
    _sum: { quantity: true },
  });
  return movs.reduce((acc, m) => {
    const q = Number(m._sum.quantity ?? 0);
    return ["ENTRADA", "AJUSTE"].includes(m.type) ? acc + q : acc - q;
  }, 0);
}

/** Lança um fiado pela TELA — é o mesmo caminho interno do PDV. */
async function lancarFiado(page: import("@playwright/test").Page, nome: string) {
  await page.goto("/fiado/novo");
  await page.getByLabel("Cliente", { exact: true }).fill(nome);
  // O rótulo da opção traz a unidade junto: "Nome (Caixa)".
  await page.getByLabel("Produto do item 1").selectOption({ label: `${PRODUTO} (Caixa)` });
  await page.getByLabel("Quantidade do item 1").fill(String(QTD));
  await page.getByLabel("Preço unitário do item 1").fill(String(PRECO));
  await page.getByRole("button", { name: "Lançar fiado" }).click();
  /*
    Espera o TOAST, e não a URL.

    `waitForURL(/\/fiado/)` passaria de imediato — `/fiado/novo` já casa com esse
    padrão —, e o teste seguiria para asserções sobre uma conta que nunca foi
    criada, falhando três telas depois do erro real. Esperar a confirmação
    ancora a falha onde ela acontece e mostra a mensagem do servidor.
  */
  await expect(page.getByText(/Fiado lançado/i)).toBeVisible();
  await page.waitForURL(/\/fiado$/, { timeout: 15_000 });
}

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
      unitCost: 10,
      sourceType: "MANUAL",
      reason: "Estoque do teste de fiado",
    },
  });
});

test.afterAll(async () => {
  const contas = await prisma.creditAccount.findMany({
    where: { tenantId, customerName: { contains: MARCA } },
    select: { id: true },
  });
  const contaIds = contas.map((c) => c.id);
  await prisma.creditPayment.deleteMany({ where: { accountId: { in: contaIds } } });
  await prisma.creditAccount.deleteMany({ where: { id: { in: contaIds } } });

  const vendas = await prisma.sale.findMany({
    where: { tenantId, items: { some: { productId } } },
    select: { id: true },
  });
  const vendaIds = vendas.map((v) => v.id);
  await prisma.salePayment.deleteMany({ where: { saleId: { in: vendaIds } } });
  await prisma.saleItem.deleteMany({ where: { saleId: { in: vendaIds } } });
  await prisma.sale.deleteMany({ where: { id: { in: vendaIds } } });

  await prisma.stockMovement.deleteMany({ where: { tenantId, productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.$disconnect();
});

test.describe("Receber fiado", () => {
  test("pagamento parcial abate o saldo; o que quita move a conta para as pagas", async ({
    page,
  }) => {
    const nome = cliente("Parcial");
    await lancarFiado(page, nome);

    await page.goto("/fiado");
    const linha = page.getByRole("row").filter({ hasText: nome });
    await expect(linha).toContainText(TOTAL);

    // Recebimento PARCIAL: R$ 30 de R$ 100.
    await linha.getByRole("button", { name: "Receber" }).click();
    const valor = page.getByLabel("Valor recebido");
    await valor.fill("30");
    await page.getByRole("button", { name: "Confirmar" }).click();

    /*
      A tela diz quanto falta — é o número que o dono repete para o cliente.

      `\s` entre "R$" e o valor, e não um espaço literal: o `Intl` em pt-BR usa
      espaço NÃO SEPARÁVEL (U+00A0) aí. Asserção por string o Playwright
      normaliza; por regex, não — e um espaço comum nunca casaria.
    */
    await expect(page.getByText(/faltam R\$\s*70,00/i)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: nome })).toContainText("R$ 70,00");

    // Segundo recebimento QUITA. O valor já vem preenchido com o saldo.
    await page.getByRole("row").filter({ hasText: nome }).getByRole("button", { name: "Receber" }).click();
    await expect(page.getByLabel("Valor recebido")).toHaveValue("R$ 70,00");
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/quitada/i)).toBeVisible();

    // Sai das contas em aberto e aparece nas quitadas — a conta não some, muda
    // de lugar. Some da lista de aberto seria perder o histórico de quem pagou.
    await page.goto("/fiado?status=EM_ABERTO");
    await expect(page.getByRole("row").filter({ hasText: nome })).toHaveCount(0);

    await page.goto("/fiado?status=PAGO");
    const quitada = page.getByRole("row").filter({ hasText: nome });
    await expect(quitada).toBeVisible();
    await expect(quitada).toContainText("Quitada");
  });

  test("recusa receber mais do que o cliente deve", async ({ page }) => {
    /*
      Receber acima do saldo criaria crédito do cliente contra o box — um valor
      negativo a receber que nenhuma tela sabe mostrar. O servidor recusa e diz
      qual é o saldo, para o operador corrigir o valor sem sair da tela.
    */
    const nome = cliente("Excesso");
    await lancarFiado(page, nome);

    await page.goto("/fiado");
    await page.getByRole("row").filter({ hasText: nome }).getByRole("button", { name: "Receber" }).click();

    await page.getByLabel("Valor recebido").fill("500");
    await page.getByRole("button", { name: "Confirmar" }).click();

    await expect(page.getByText(/maior que o saldo devedor/i)).toBeVisible();

    // E o saldo continua intacto.
    await page.goto("/fiado");
    await expect(page.getByRole("row").filter({ hasText: nome })).toContainText(TOTAL);
  });

  test("excluir lançamento sem pagamento devolve a mercadoria ao estoque", async ({ page }) => {
    /*
      "Excluir" aqui não é esconder a linha: desfaz a venda inteira e devolve o
      estoque. O teste mede o SALDO antes e depois porque é esse o efeito que
      ninguém confere à mão — e o que faz o inventário fechar no fim do mês.
    */
    const nome = cliente("Excluir");
    const antes = await saldoEmEstoque();

    await lancarFiado(page, nome);
    expect(await saldoEmEstoque()).toBe(antes - QTD);

    await page.goto("/fiado");
    await page.getByRole("row").filter({ hasText: nome }).getByRole("link").first().click();
    await page.waitForURL(/\/fiado\/[a-z0-9]+/i, { timeout: 15_000 });

    await page.getByRole("button", { name: "Excluir lançamento" }).click();
    await page.getByRole("button", { name: "Excluir e desfazer" }).click();

    await expect(page.getByText(/venda desfeita/i)).toBeVisible();
    expect(await saldoEmEstoque()).toBe(antes);
  });

  test("conta com pagamento não oferece excluir — o dinheiro que entrou não some", async ({
    page,
  }) => {
    const nome = cliente("ComPagamento");
    await lancarFiado(page, nome);

    await page.goto("/fiado");
    await page.getByRole("row").filter({ hasText: nome }).getByRole("button", { name: "Receber" }).click();
    await page.getByLabel("Valor recebido").fill("10");
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/faltam/i)).toBeVisible();

    await page.getByRole("row").filter({ hasText: nome }).getByRole("link").first().click();
    await page.waitForURL(/\/fiado\/[a-z0-9]+/i, { timeout: 15_000 });

    // A UI nem oferece o botão: apagar a conta sumiria com dinheiro que já
    // entrou no caixa. O servidor também recusa (`fiado-crud.test.ts`), mas a
    // tela não pode chegar a oferecer a ação.
    await expect(page.getByRole("button", { name: "Excluir lançamento" })).toHaveCount(0);
  });
});
