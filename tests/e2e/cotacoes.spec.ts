import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { estouroHorizontalDaPagina, vazamentos } from "./_helpers/vazamentos";

/**
 * A tela de cotações remodelada: a grade de cartões e o histórico do produto.
 *
 * Monta os próprios dados e desmonta no fim, no molde de `layout-caixas.spec.ts`
 * — a empresa demo é compartilhada, e um resto deixado para trás vira falha
 * inexplicável em outro arquivo.
 *
 * O que se afirma aqui não é "a página abriu". São as três coisas que a grade
 * pode errar sem quebrar nada: chamar de "ontem" um boletim que não é de ontem,
 * esconder os produtos do cliente no meio dos duzentos da praça, e estourar o
 * cartão no celular quando o nome do produto é comprido.
 */

const prisma = new PrismaClient();
const DEMO = { email: "demo@ceasapro.com.br" };

const SUFIXO = "E2EC";
const MINHA = `${SUFIXO}MIN`;
const VIZINHA = `${SUFIXO}VIZ`;

/** Nome longo de propósito: é ele que estoura o cartão estreito, se estourar. */
const PRODUTO_LONGO = `TOMATE LONGA VIDA EXTRA AA DE PRIMEIRA ${SUFIXO}`;
const PRODUTO_CURTO = `ALHO ${SUFIXO}`;

let tenantId = "";
let centralOriginal: string | null = null;

/** Meia-noite UTC de N dias atrás. */
function diasAtras(n: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n));
}

const DIAS_DO_ANTERIOR = 6;

test.beforeAll(async () => {
  const dono = await prisma.user.findFirstOrThrow({
    where: { email: DEMO.email },
    select: { tenantId: true },
  });
  if (!dono.tenantId) throw new Error("empresa demo sem tenant");
  tenantId = dono.tenantId;
  const t = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { ceasaCentralCode: true },
  });
  centralOriginal = t.ceasaCentralCode;

  await prisma.ceasaCentral.createMany({
    data: [
      {
        code: MINHA,
        name: `Praça E2E da Empresa`,
        city: "Contagem",
        uf: "MG",
        sourceKey: "ceasaminas",
        maxDiasSemBoletim: 7,
      },
      {
        code: VIZINHA,
        name: `Praça E2E Vizinha`,
        city: "Uberlândia",
        uf: "MG",
        sourceKey: "ceasaminas",
        maxDiasSemBoletim: 7,
      },
    ],
  });

  const longo = await prisma.ceasaProduct.create({
    data: { name: PRODUTO_LONGO, slug: `tomate-longa-vida-${SUFIXO.toLowerCase()}`, serie: "CENTRAL" },
  });
  const curto = await prisma.ceasaProduct.create({
    data: { name: PRODUTO_CURTO, slug: `alho-${SUFIXO.toLowerCase()}`, serie: "CENTRAL" },
  });

  /*
    Dois boletins, com SEIS DIAS entre eles.

    O intervalo é a razão de ser do teste: é a cadência real de quem publica 2 a
    3 vezes por semana, e é o que torna a palavra "ontem" uma mentira no cartão.
  */
  await prisma.ceasaQuote.createMany({
    data: [
      {
        centralCode: MINHA,
        ceasaProductId: longo.id,
        quoteDate: diasAtras(DIAS_DO_ANTERIOR),
        unit: "KG",
        refPrice: 5,
      },
      // Valor absurdo de propósito: 16 caracteres no cartão estreito.
      {
        centralCode: MINHA,
        ceasaProductId: longo.id,
        quoteDate: diasAtras(0),
        unit: "KG",
        refPrice: 9999999.99,
        minPrice: 9999999.0,
        maxPrice: 9999999.99,
      },
      { centralCode: MINHA, ceasaProductId: curto.id, quoteDate: diasAtras(0), unit: "KG", refPrice: 18 },
      // A vizinha, para o comparativo ter com quem comparar.
      { centralCode: VIZINHA, ceasaProductId: longo.id, quoteDate: diasAtras(0), unit: "KG", refPrice: 4 },
    ],
  });

  await prisma.tenant.update({ where: { id: tenantId }, data: { ceasaCentralCode: MINHA } });

  // Um produto do cliente vinculado, para existir a seção verde.
  const meu = await prisma.product.findFirst({
    where: { tenantId, deletedAt: null, active: true },
    select: { id: true },
  });
  if (meu) {
    await prisma.tenantCeasaLink.create({
      data: { tenantId, productId: meu.id, ceasaProductId: longo.id },
    });
  }
});

test.afterAll(async () => {
  await prisma.tenantCeasaLink.deleteMany({ where: { tenantId } });
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { ceasaCentralCode: centralOriginal },
  });
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: { in: [MINHA, VIZINHA] } } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: { in: [MINHA, VIZINHA] } } });
  await prisma.ceasaCentral.deleteMany({ where: { code: { in: [MINHA, VIZINHA] } } });
  await prisma.ceasaProduct.deleteMany({
    where: { slug: { in: [`tomate-longa-vida-${SUFIXO.toLowerCase()}`, `alho-${SUFIXO.toLowerCase()}`] } },
  });
  await prisma.$disconnect();
});

test.describe("Grade de cotações", () => {
  test("separa o que a empresa vende do resto da praça", async ({ page }) => {
    await page.goto("/cotacoes?filtro=TODOS");

    await expect(page.getByRole("heading", { name: /Produtos que você vende/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Outros produtos da CEASA/ })).toBeVisible();

    // O produto vinculado carrega o selo, e é o único que carrega.
    const selos = page.getByText("Você vende", { exact: true });
    await expect(selos).toHaveCount(1);

    const cartaoLongo = page.locator(`a[href^="/cotacoes/produto/"]`).filter({ hasText: PRODUTO_LONGO });
    await expect(cartaoLongo).toBeVisible();
    await expect(cartaoLongo).toContainText("Você vende");
  });

  test("mostra a data do boletim anterior, e nunca a palavra 'ontem'", async ({ page }) => {
    /*
      A regra de negócio mais fácil de quebrar por descuido de redação. O boletim
      anterior é de seis dias atrás; escrever "Ontem: R$ 5,00" faria o
      comerciante repassar como recente um preço da semana passada.
    */
    await page.goto("/cotacoes?filtro=TODOS");

    const cartao = page.locator(`a[href^="/cotacoes/produto/"]`).filter({ hasText: PRODUTO_LONGO });
    const anterior = diasAtras(DIAS_DO_ANTERIOR);
    const dia = String(anterior.getUTCDate()).padStart(2, "0");
    const mes = String(anterior.getUTCMonth() + 1).padStart(2, "0");

    await expect(cartao).toContainText(`${dia}/${mes}`);
    await expect(cartao).toContainText("R$ 5,00");
    await expect(cartao).not.toContainText(/ontem/i);
    await expect(page.locator("main")).not.toContainText(/ontem/i);
  });

  test("o cartão leva ao histórico do produto", async ({ page }) => {
    await page.goto("/cotacoes?filtro=TODOS");
    await page.locator(`a[href^="/cotacoes/produto/"]`).filter({ hasText: PRODUTO_CURTO }).click();

    await page.waitForURL(/\/cotacoes\/produto\//);
    await expect(page.getByRole("heading", { name: PRODUTO_CURTO })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Histórico de preço" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preço em outras praças" })).toBeVisible();
  });
});

test.describe("Histórico do produto", () => {
  test("o período muda a janela sem perder a unidade", async ({ page }) => {
    await page.goto("/cotacoes?filtro=TODOS");
    await page.locator(`a[href^="/cotacoes/produto/"]`).filter({ hasText: PRODUTO_LONGO }).click();
    await page.waitForURL(/\/cotacoes\/produto\//);

    await page.getByRole("link", { name: "30 dias" }).click();
    await expect(page).toHaveURL(/dias=30/);
    // A unidade sobrevive à troca de período: sem ela a tela abriria o produto
    // em outra embalagem, com outro preço, sem nada indicando a troca.
    await expect(page).toHaveURL(/u=KG/);
    await expect(page.getByText("2 boletins no período.")).toBeVisible();
  });

  test("compara praças mostrando a data de cada uma", async ({ page }) => {
    await page.goto("/cotacoes?filtro=TODOS");
    await page.locator(`a[href^="/cotacoes/produto/"]`).filter({ hasText: PRODUTO_LONGO }).click();
    await page.waitForURL(/\/cotacoes\/produto\//);

    const comparativo = page.locator("section").filter({ hasText: "Preço em outras praças" });
    await expect(comparativo).toContainText("Praça E2E Vizinha");
    await expect(comparativo).toContainText("Praça E2E da Empresa");
    await expect(comparativo).toContainText("(sua praça)");
    // A data por linha é o que impede o comparativo de mentir por omissão.
    await expect(comparativo).toContainText(/boletim de \d{2}\/\d{2}\/\d{4}/);
  });

  test("produto que a praça da empresa não cota devolve 404", async ({ page }) => {
    const r = await page.goto("/cotacoes/produto/naoexiste123?u=KG");
    expect(r?.status()).toBe(404);
  });
});

test.describe("A grade cabe no celular", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test("nada escapa do cartão nem empurra a página de lado", async ({ page }) => {
    /*
      320px é o menor celular em uso, e a grade de cartões é justamente onde o
      espaço aperta: nome comprido, preço de 16 caracteres e minigráfico
      disputando a mesma linha. Mede no navegador em vez de conferir classes,
      pelo mesmo motivo de `layout-caixas.spec.ts`: o texto cortado na borda
      continua presente no DOM, e uma asserção de texto passaria com o defeito.
    */
    await page.goto("/cotacoes?filtro=TODOS");
    await expect(page.getByRole("heading", { name: /Outros produtos da CEASA/ })).toBeVisible();

    expect(await vazamentos(page)).toEqual([]);
    expect(await estouroHorizontalDaPagina(page)).toBe(0);
  });

  test("a tela de histórico também cabe", async ({ page }) => {
    await page.goto("/cotacoes?filtro=TODOS");
    await page.locator(`a[href^="/cotacoes/produto/"]`).filter({ hasText: PRODUTO_LONGO }).click();
    await page.waitForURL(/\/cotacoes\/produto\//);
    await expect(page.getByRole("heading", { name: "Histórico de preço" })).toBeVisible();

    expect(await vazamentos(page)).toEqual([]);
    expect(await estouroHorizontalDaPagina(page)).toBe(0);
  });
});
