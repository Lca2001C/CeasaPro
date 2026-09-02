import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Sessão que vence no meio do trabalho.
 *
 * Reproduz uma falha de produção: num iPhone, `POST /api/compras` levou 401 do
 * proxy — duas vezes seguidas, cinco segundos entre uma e outra (a pessoa
 * tentando salvar de novo). A compra inteira se perdeu.
 *
 * A causa não era o aparelho. O access token dura 15 minutos e o cookie dele
 * expira no mesmo prazo; o refresh token vale 30 dias, mas NADA o usava
 * automaticamente. Quem levasse mais de 15 minutos preenchendo uma compra —
 * comum no celular, digitando item por item — apertava "Salvar" e recebia 401.
 *
 * O teste apaga o cookie de acesso e deixa o de refresh, que é exatamente o
 * estado do navegador depois dos 15 minutos. Não há como esperar 15 minutos num
 * teste, e mexer no relógio não expiraria o cookie do lado do navegador.
 */

const prisma = new PrismaClient();
const DEMO = { email: "demo@ceasapro.com.br", senha: "demo123" };

const ACCESS = "cp_access";
const REFRESH = "cp_refresh";

let tenantId = "";

async function entrar(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Agora não" }).click();
}

/** Nomes dos cookies de sessão presentes no navegador. */
async function cookiesDeSessao(context: import("@playwright/test").BrowserContext) {
  const todos = await context.cookies();
  return todos.filter((c) => c.name === ACCESS || c.name === REFRESH).map((c) => c.name);
}

async function comprasDoTenant(): Promise<number> {
  return prisma.purchase.count({ where: { tenantId } });
}

test.beforeAll(async () => {
  const dono = await prisma.user.findFirstOrThrow({
    where: { email: DEMO.email },
    select: { tenantId: true },
  });
  if (!dono.tenantId) throw new Error("empresa demo sem tenant");
  tenantId = dono.tenantId;
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Access token vencido no meio do formulário", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a compra é salva: a sessão se renova sozinha e a requisição é repetida", async ({
    page,
    context,
  }) => {
    await entrar(page);
    await page.goto("/compras/nova");
    await expect(page.getByRole("button", { name: "Salvar compra" })).toBeVisible();

    // 15 minutos depois: o navegador já descartou o cookie de acesso (maxAge),
    // e só o de refresh continua lá.
    await context.clearCookies({ name: ACCESS });
    expect(await cookiesDeSessao(context)).toEqual([REFRESH]);

    const antes = await comprasDoTenant();

    // O formulário já nasce válido (1 unidade do primeiro produto), que é o
    // mesmo estado de quem terminou de preencher e aperta salvar.
    await page.getByRole("button", { name: "Salvar compra" }).click();

    // O que o usuário tem de ver: a compra registrada — não um 401.
    await expect(page.getByText(/Compra registrada/i)).toBeVisible();
    await expect(page).toHaveURL(/\/compras$/);

    // E gravada de verdade. Sem esta asserção, um toast otimista passaria.
    expect(await comprasDoTenant()).toBe(antes + 1);

    // A sessão foi reemitida no caminho, então o próximo salvamento não repete
    // o desvio.
    expect((await cookiesDeSessao(context)).sort()).toEqual([ACCESS, REFRESH]);
  });

  test("navegar entre telas renova a sessão em vez de cair no login", async ({
    page,
    context,
  }) => {
    await entrar(page);

    // Navegação de página não passa pelo `apiPost`, então quem resolve aqui é o
    // desvio do proxy para /api/auth/renovar. Sem ele, voltar ao app depois de
    // 15 minutos jogava a pessoa no login apesar de o refresh token valer 30
    // dias — o "cai toda hora" no celular.
    await context.clearCookies({ name: ACCESS });
    expect(await cookiesDeSessao(context)).toEqual([REFRESH]);

    await page.goto("/estoque");

    await expect(page).toHaveURL(/\/estoque$/);
    await expect(page.getByRole("heading", { name: /Estoque/i }).first()).toBeVisible();
    // E a sessão voltou, então a navegação seguinte não repete o desvio.
    expect((await cookiesDeSessao(context)).sort()).toEqual([ACCESS, REFRESH]);
  });

  test("o destino é preservado, inclusive a query", async ({ page, context }) => {
    await entrar(page);
    await context.clearCookies({ name: ACCESS });

    // Quem clicou num link filtrado tem de chegar no link filtrado, não na raiz.
    await page.goto("/despesas?filtro=PENDENTE");

    await expect(page).toHaveURL(/\/despesas\?filtro=PENDENTE$/);
  });
});

test.describe("A rota de renovação não abre brecha", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("refresh token forjado não vira acesso", async ({ page, context }) => {
    // O proxy passou a desviar para a renovação quando VÊ um cookie de refresh —
    // e ele não tem como validá-lo (o token é opaco e a checagem exige banco).
    // Quem valida é a rota, e é isso que este teste trava: inventar o cookie não
    // pode virar sessão.
    await context.addCookies([
      {
        name: REFRESH,
        value: "token-inventado-por-atacante",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/estoque");

    await expect(page).toHaveURL(/\/login/);
    // E o cookie inválido é descartado, para a próxima navegação não repetir o
    // desvio inutilmente.
    expect(await cookiesDeSessao(context)).toEqual([]);
  });

  test("não redireciona para fora do domínio", async ({ page, context }) => {
    await context.addCookies([
      { name: REFRESH, value: "invalido", domain: "localhost", path: "/" },
    ]);

    // `//golpe.com` começa com "/", então passaria por uma checagem ingênua — e
    // o navegador o trataria como domínio externo. Com o nosso domínio no link
    // clicado, é material de phishing.
    await page.goto("/api/auth/renovar?next=%2F%2Fgolpe.com");

    await expect(page).toHaveURL(/localhost:3000/);
    await expect(page).not.toHaveURL(/golpe\.com/);
  });

  test("recusa requisição que não é navegação", async ({ request }) => {
    // A rota rotaciona o refresh token, e um GET que muda estado pode ser
    // disparado de outro site por uma `<img>`. Só navegação de topo manda
    // `Sec-Fetch-Mode: navigate`.
    const res = await request.get("/api/auth/renovar?next=%2Fdashboard", {
      headers: { "Sec-Fetch-Mode": "no-cors" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("Sessão realmente encerrada", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sem refresh token, avisa em vez de fingir que salvou", async ({ page, context }) => {
    await entrar(page);
    await page.goto("/compras/nova");
    await expect(page.getByRole("button", { name: "Salvar compra" })).toBeVisible();

    // Logout em outro aparelho, conta desativada, 30 dias sem usar: não há como
    // renovar.
    await context.clearCookies({ name: ACCESS });
    await context.clearCookies({ name: REFRESH });

    const antes = await comprasDoTenant();
    await page.getByRole("button", { name: "Salvar compra" }).click();

    // A mensagem tem de dizer o que fazer. "Nao autenticado" (o texto anterior,
    // vindo do proxy) não diz nada a quem está no balcão.
    await expect(page.getByText(/sess[aã]o expirou/i)).toBeVisible();
    // E nada pode ter sido gravado.
    expect(await comprasDoTenant()).toBe(antes);
  });
});
