import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { estouroHorizontalDaPagina, vazamentos } from "./_helpers/vazamentos";

/**
 * Nada escapa da sua caixa — em nenhum módulo, com nenhum tamanho de valor.
 *
 * Este teste MEDE no navegador em vez de conferir classes CSS: compara o
 * retângulo de cada cartão com o de cada elemento dentro dele. É a única forma
 * honesta de verificar a exigência, porque o defeito original ("R$ 11.000,00"
 * cortado na borda) não aparece em nenhuma asserção de texto — o texto está lá,
 * só não está visível. Um teste de classe CSS passaria com o defeito presente.
 *
 * Roda em tela ESTREITA (320px, o menor celular em uso) e em duas colunas, que é
 * onde o espaço aperta. No desktop tudo cabe e nada disto reproduz.
 */

const prisma = new PrismaClient();

/** Valor absurdo de propósito: 16 caracteres, o pior caso realista. */
const VALOR_EXTREMO = 9999999.99;
const DESCRICAO = "ZZE2E despesa gigante para teste de layout";

let despesaId: string | null = null;

/** Páginas com cartão de número, uma por módulo. */
const PAGINAS = [
  { url: "/dashboard", nome: "Início" },
  { url: "/despesas", nome: "Despesas" },
  { url: "/estoque", nome: "Estoque" },
  { url: "/fiado", nome: "Fiado" },
  { url: "/embalagens", nome: "Embalagens" },
  { url: "/caixas-plasticas", nome: "Caixas plásticas" },
  { url: "/higienizacao", nome: "Higienização" },
  { url: "/plano", nome: "Meu plano" },
];

const DEMO = { email: "demo@ceasapro.com.br", senha: "demo123" };

async function entrar(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Agora não" }).click();
}

test.beforeAll(async () => {
  const dono = await prisma.user.findFirstOrThrow({
    where: { email: DEMO.email },
    select: { tenantId: true },
  });
  if (!dono.tenantId) throw new Error("empresa demo sem tenant");

  // Uma despesa de R$ 9.999.999,99 faz vários cartões do painel exibirem 16
  // caracteres de uma vez — "Contas do mês", "Contas variáveis", "Sobrou no
  // mês" e a margem em %. É o caminho mais barato de forçar o pior caso com
  // dado de verdade, em vez de fingir um valor no DOM.
  const criada = await prisma.expense.create({
    data: {
      tenantId: dono.tenantId,
      description: DESCRICAO,
      amount: VALOR_EXTREMO,
      type: "VARIAVEL",
      status: "PENDENTE",
      dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });
  despesaId = criada.id;
});

test.afterAll(async () => {
  try {
    if (despesaId) await prisma.expense.delete({ where: { id: despesaId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});

test.describe("Cartões de número — tela estreita (320px)", () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 320, height: 720 },
  });

  test("o valor extremo aparece INTEIRO e dentro da caixa", async ({ page }) => {
    await entrar(page);

    // Abre a seção recolhível, que é onde estão os cartões da captura original.
    await page.getByText("Ver financeiro completo").click();

    // O valor tem de estar no documento por completo — o defeito original não
    // removia texto, só o escondia, então esta asserção sozinha não bastaria.
    await expect(page.getByText("9.999.999,99").first()).toBeVisible();

    const problemas = await vazamentos(page);
    expect(problemas, JSON.stringify(problemas, null, 2)).toEqual([]);

    // E a PÁGINA não pode rolar de lado. É um defeito diferente e independente:
    // todos os cartões podem estar contidos e, ainda assim, a coluna da direita
    // aparecer cortada porque a página inteira ficou mais larga que a tela.
    expect(await estouroHorizontalDaPagina(page)).toBe(0);
  });

  test("o sinal de negativo não fica sozinho numa linha", async ({ page }) => {
    await entrar(page);
    await page.getByText("Ver financeiro completo").click();

    // Com a despesa gigante, "Sobrou no mês" e a margem ficam negativos. O sinal
    // precisa estar COLADO no "R$": um "−" órfão na linha de cima faz o leitor
    // entender lucro onde há prejuízo.
    //
    // Quebra de linha feita pelo CSS NÃO aparece no `textContent`, então medir o
    // texto não serve. O que responde é `Range.getClientRects()`: ele devolve um
    // retângulo por linha VISUAL, então o prefixo "−R$" gerar dois retângulos
    // significa que o sinal se separou.
    const sinaisSeparados = await page.evaluate(() => {
      const quebrados: string[] = [];
      for (const el of Array.from(document.querySelectorAll(".bg-card *"))) {
        if (el.children.length > 0) continue;
        const no = el.firstChild;
        if (!no || no.nodeType !== Node.TEXT_NODE) continue;
        const texto = no.textContent ?? "";
        if (!/^[-−]/.test(texto) || texto.length < 3) continue;

        const faixa = document.createRange();
        faixa.setStart(no, 0);
        faixa.setEnd(no, 3); // o sinal e o "R$" (ou os 2 primeiros dígitos)
        if (faixa.getClientRects().length > 1) {
          quebrados.push(texto.trim().slice(0, 24));
        }
      }
      return quebrados;
    });
    expect(sinaisSeparados).toEqual([]);
  });

  for (const pagina of PAGINAS) {
    test(`${pagina.nome}: nada vaza dos cartões`, async ({ page }) => {
      await entrar(page);
      await page.goto(pagina.url);
      // Os cartões são a primeira coisa da tela em todas essas páginas.
      await expect(page.locator(".bg-card").first()).toBeVisible();

      const problemas = await vazamentos(page);
      expect(problemas, `${pagina.nome}: ${JSON.stringify(problemas, null, 2)}`).toEqual([]);
      expect(await estouroHorizontalDaPagina(page), `${pagina.nome} rola de lado`).toBe(0);
    });
  }
});

/**
 * Todas as OUTRAS telas da empresa, também em 320px.
 *
 * A varredura acima cobre oito telas — as que têm cartão de número. Metade da
 * aplicação ficava de fora, incluindo as que mais mudaram: histórico de vendas,
 * detalhe da venda, categorias de despesa. Uma tela que rola de lado no celular
 * é defeito visível para o usuário, não detalhe.
 *
 * Aqui a exigência é mais fraca de propósito: não exige que a tela TENHA cartão
 * (várias abrem em estado vazio), então mede o estouro da página sempre e o
 * vazamento de cartão só quando existe algum. Assim a lista pode crescer sem
 * ficar refém de dados de seed.
 */
const OUTRAS_PAGINAS = [
  { url: "/vendas", nome: "Vendas (histórico)" },
  { url: "/produtos", nome: "Produtos" },
  { url: "/compras", nome: "Compras" },
  { url: "/fornecedores", nome: "Fornecedores" },
  { url: "/relatorios", nome: "Relatórios" },
  { url: "/despesas/categorias", nome: "Categorias de despesa" },
  { url: "/despesas/nova", nome: "Nova despesa" },
  { url: "/fiado/novo", nome: "Novo fiado" },
  { url: "/configuracoes", nome: "Configurações" },
  { url: "/ajuda", nome: "Como usar" },
];

test.describe("Telas em tela estreita (320px)", () => {
  // Só o viewport: aproveita a sessão do projeto `authed` em vez de fazer login
  // dez vezes. Com a sessão pronta, `/login` redirecionaria para o painel e o
  // helper `entrar` não acharia o campo de e-mail — e dez logins seguidos ainda
  // esbarrariam no rate limit.
  test.use({ viewport: { width: 320, height: 720 } });

  for (const pagina of OUTRAS_PAGINAS) {
    test(`${pagina.nome}: não rola de lado nem vaza`, async ({ page }) => {
      await page.goto(pagina.url);
      // Espera a tela pintar: o título é o que toda página tem.
      await expect(page.locator("h1, h2").first()).toBeVisible();

      expect(await estouroHorizontalDaPagina(page), `${pagina.nome} rola de lado`).toBe(0);

      if ((await page.locator(".bg-card").count()) > 0) {
        const problemas = await vazamentos(page);
        expect(problemas, `${pagina.nome}: ${JSON.stringify(problemas, null, 2)}`).toEqual([]);
      }
    });
  }
});
