import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Produtos — cadastro, edição e exclusão, dentro do Estoque.
 *
 * Produto não tem mais tela própria: nasce no modal "Novo Produto" sobre
 * `/estoque` (aberto pelo cartão "Adicionar Novo Produto"), é editado no mesmo
 * modal (`?editar=<id>`) e aparece como cartão na lista do estoque. O que este
 * arquivo prova é que esse caminho fecha o ciclo inteiro sem sair da tela.
 */

const prisma = new PrismaClient();

const SUFIXO = `${Date.now()}`;
/** Prefixo comum, para a limpeza achar tudo mesmo se uma asserção falhar. */
const MARCA = `Produto E2E ${SUFIXO}`;

let tenantId = "";

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({
    where: { email: "demo@ceasapro.com.br" },
    select: { tenantId: true },
  });
  tenantId = owner.tenantId!;
});

test.afterAll(async () => {
  /*
    A exclusão pela tela é soft delete, e o produto com estoque inicial deixa
    um movimento de ENTRADA. Apagar de fato aqui evita que o "valor em estoque"
    da empresa demo carregue o resíduo deste teste para os outros specs.
  */
  const produtos = await prisma.product.findMany({
    where: { tenantId, name: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = produtos.map((p) => p.id);
  if (ids.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { tenantId, productId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

/** O cartão do produto na lista do Estoque. */
const cartao = (page: Page, nome: string) =>
  page.locator('main [data-slot="card"]').filter({ hasText: nome });

/** Abre o modal pelo cartão de destaque — o caminho de quem está no balcão. */
async function abrirNovoProduto(page: Page) {
  await page.goto("/estoque");
  await page.getByRole("link", { name: /Adicionar Novo Produto/ }).click();
  const modal = page.getByRole("dialog", { name: "Novo Produto" });
  await expect(modal).toBeVisible();
  return modal;
}

test.describe("Produtos — cadastro, edição e exclusão no Estoque", () => {
  test("criar, editar e excluir um produto", async ({ page }) => {
    const name = `${MARCA} simples`;
    const renamed = `${name} editado`;

    // Criar
    const novo = await abrirNovoProduto(page);
    await novo.getByLabel("Nome do Produto").fill(name);
    await novo.getByLabel("Embalagem").selectOption("KG");
    await novo.getByRole("button", { name: "Salvar Produto" }).click();

    // O modal fecha sozinho e a lista já traz o produto, sem recarregar.
    await expect(page.getByText("Produto cadastrado")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(cartao(page, name)).toBeVisible();

    // Editar — pelo lápis do cartão, que abre o mesmo modal em modo edição.
    // `exact`: depois do rename, "Editar <nome> editado" também casaria.
    await page.getByRole("link", { name: `Editar ${name}`, exact: true }).click();
    const edicao = page.getByRole("dialog", { name: "Editar produto" });
    await expect(edicao).toBeVisible();
    await expect(edicao.getByLabel("Nome do Produto")).toHaveValue(name);
    await edicao.getByLabel("Nome do Produto").fill(renamed);
    await edicao.getByRole("button", { name: "Salvar alterações" }).click();

    await expect(page.getByText("Produto atualizado")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(cartao(page, renamed)).toBeVisible();

    // Excluir (com diálogo de confirmação)
    await cartao(page, renamed).getByRole("button", { name: "Excluir" }).click();
    const confirmar = page.getByRole("dialog", { name: `Excluir o produto ${renamed}?` });
    await expect(confirmar).toBeVisible();
    await confirmar.getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByText(renamed)).toHaveCount(0);
  });

  test("estoque inicial com custo já entra no saldo e no valor", async ({ page }) => {
    /*
      O motivo de o cadastro ter virado modal no Estoque: antes eram três telas
      (produto → compra → estoque) para ter algo à venda. Agora o produto nasce
      com o que já está no box, e o custo informado é o que vira custo médio —
      10 caixas a R$ 45,50 valem R$ 455,00. Se o custo não chegasse ao
      movimento de entrada, o cartão mostraria a quantidade certa e valor zero,
      e o lucro das primeiras vendas sairia inflado.
    */
    const name = `${MARCA} com estoque`;

    const novo = await abrirNovoProduto(page);
    await novo.getByLabel("Nome do Produto").fill(name);
    await expect(novo.getByLabel("Embalagem")).toHaveValue("CAIXA");

    // O custo só é pedido quando há estoque inicial.
    await expect(novo.getByLabel(/Quanto custou cada/)).toHaveCount(0);
    await novo.getByLabel("Estoque Inicial").fill("10");

    // `fill` num campo de moeda: digitar sobre a máscara depende de onde o
    // cursor parou — a mesma armadilha documentada em `pdv.spec.ts`.
    const custo = novo.getByLabel(/Quanto custou cada caixa/);
    await expect(custo).toBeVisible();
    await custo.fill("45,50");
    await expect(custo).toHaveValue("R$ 45,50");

    await novo.getByRole("button", { name: "Salvar Produto" }).click();
    await expect(page.getByText("Produto cadastrado")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Quantidade, custo médio e valor — as três leituras do cartão.
    const card = cartao(page, name);
    await expect(card).toBeVisible();
    await expect(card).toContainText("10");
    await expect(card).toContainText("R$ 45,50");
    await expect(card).toContainText("R$ 455,00");
    // Com saldo, o cartão já oferece vender.
    await expect(card.getByRole("link", { name: `Vender ${name}` })).toBeVisible();
  });
});
