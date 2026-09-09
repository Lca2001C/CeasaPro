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
let meuProdutoNome = "";
let idDoLongo = "";

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
    select: { id: true, name: true },
  });
  if (meu) {
    meuProdutoNome = meu.name;
    await prisma.tenantCeasaLink.create({
      data: { tenantId, productId: meu.id, ceasaProductId: longo.id },
    });
  }
  idDoLongo = longo.id;

  // O alerta nasce no setup para que cada teste seja independente do anterior.
  // Encadear "salva num teste, confere no outro" faz o segundo falhar por
  // motivo errado sempre que o primeiro quebra.
  await prisma.tenantCeasaAlerta.create({
    data: { tenantId, ceasaProductId: longo.id, unit: "KG", variacaoMinima: 10 },
  });
});

test.afterAll(async () => {
  await prisma.tenantCeasaAlerta.deleteMany({ where: { tenantId } });
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


test.describe("Alertas de flutuação", () => {
  /*
    O alerta já existe (criado no setup), e cada teste aqui é independente do
    anterior de propósito. Encadear "salva num teste, confere no outro" faz o
    segundo falhar por motivo errado toda vez que o primeiro quebra — e foi
    exatamente o que aconteceu na primeira versão deste arquivo.

    O produto usado tem alta gigantesca entre os dois boletins (R$ 5,00 para
    R$ 9.999.999,99), então qualquer limiar dispara.
  */

  /** O cartão do Início, sem pegar a página inteira junto. */
  const cartaoDeCotacoes = (page: import("@playwright/test").Page) =>
    page
      .getByText("Cotações do que você compra")
      .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");

  test("o Início mostra o que a empresa acompanha, com a data do boletim", async ({ page }) => {
    await page.goto("/dashboard");
    const cartao = cartaoDeCotacoes(page);
    await expect(cartao).toBeVisible();

    // O cartão chama o produto pelo nome DO CLIENTE quando há vínculo: é assim
    // que ele conhece a própria mercadoria, não pelo nome do boletim.
    await expect(cartao).toContainText(meuProdutoNome);
    // A data é a do BOLETIM, e o cartão leva à tela do produto.
    await expect(cartao).toContainText(/Boletim de \d{2}\/\d{2}\/\d{4}/);
    await expect(cartao.locator(`a[href^="/cotacoes/produto/${idDoLongo}"]`)).toBeVisible();
  });

  test("o aviso entra no topo, agregado e SEM coluna de dinheiro", async ({ page }) => {
    /*
      `Aviso.total` passa por um formatador de REAIS nas três telas que
      renderizam aviso. Variação percentual ali escreveria "R$ 22,00" com toda a
      naturalidade — número plausível, do jeito errado. A regra é que a linha de
      cotação simplesmente não tem valor à direita.
    */
    await page.goto("/dashboard");
    const aviso = page.locator(`a[href^="/cotacoes/produto/"]`).filter({ hasText: /subiu/ }).first();
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(/subiu \d+%/);
    await expect(aviso).not.toContainText("R$ 0,00");
  });

  test("a tela do produto reflete o alerta salvo e aceita alterá-lo", async ({ page }) => {
    await page.goto(`/cotacoes/produto/${idDoLongo}?u=KG`);
    await expect(page.getByRole("heading", { name: "Me avise quando mexer" })).toBeVisible();
    await expect(page.getByText(/Avisamos você quando este item variar mais de/)).toBeVisible();

    await page.getByRole("button", { name: "Alterar aviso" }).click();
    await page.getByLabel("Avisar se variar mais de").fill("25");
    await page.getByRole("button", { name: "Salvar aviso" }).click();
    await expect(page.getByText(/variar mais de/)).toContainText("25");
  });

  test("a tela recusa piso acima do teto em vez de gravar alerta que toca sempre", async ({ page }) => {
    // Piso acima do teto faria os dois avisos dispararem em todo boletim.
    await page.goto(`/cotacoes/produto/${idDoLongo}?u=KG`);
    await page.getByRole("button", { name: "Alterar aviso" }).click();
    await page.getByLabel("Avisar se passar de (R$)").fill("3");
    await page.getByLabel("Avisar se cair abaixo de (R$)").fill("9");
    await page.getByRole("button", { name: "Salvar aviso" }).click();
    // Dois lugares, de propósito: o toast avisa quem está olhando o botão, e a
    // mensagem sob o campo diz QUAL dos três números está errado — com três
    // campos numéricos parecidos, só o toast manda a pessoa adivinhar.
    await expect(page.getByText(/piso precisa ser menor/i)).toHaveCount(2);
    await expect(page.locator("p.text-destructive", { hasText: /piso precisa ser menor/i })).toBeVisible();
  });

  test("remover o alerta tira o aviso do Início", async ({ page }) => {
    await page.goto(`/cotacoes/produto/${idDoLongo}?u=KG`);
    await page.getByRole("button", { name: "Alterar aviso" }).click();
    await page.getByRole("button", { name: "Não avisar mais" }).click();
    await expect(page.getByText("Você não recebe aviso deste item.")).toBeVisible();

    await page.goto("/dashboard");
    await expect(
      page.locator(`a[href^="/cotacoes/produto/"]`).filter({ hasText: /subiu/ }),
    ).toHaveCount(0);
    // ...mas o cartão de interesse CONTINUA: o vínculo não sumiu, só o aviso.
    await expect(cartaoDeCotacoes(page)).toBeVisible();
  });
});
