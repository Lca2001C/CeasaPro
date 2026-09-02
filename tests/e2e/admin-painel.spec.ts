import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { vazamentos } from "./_helpers/vazamentos";

/**
 * Painel do super-admin: caixa de notificações e acompanhamento de usuários.
 *
 * É o primeiro teste E2E da área `/admin`, então ele traz a própria sessão: o
 * super-admin do seed nasce com `mustChangePassword`, o que joga o login direto
 * para /alterar-senha. Em vez de mexer na senha dele (o que estragaria o banco de
 * desenvolvimento de quem rodasse a suíte por engano), o teste cria um admin
 * dedicado e identificável, e o apaga no fim.
 *
 * O caminho da notificação é exercitado de ponta a ponta de verdade: um cadastro
 * público real pela API, e o aviso aparecendo na campainha do painel. As regras
 * (dedupe, resiliência, quem recebe) estão nos testes de integração.
 */

const prisma = new PrismaClient();

// Argon2id com os mesmos parâmetros de `hashPassword`. O `verify` lê os
// parâmetros do próprio hash, então o login funciona sem duplicar constantes.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const sufixo = `${Date.now()}${randomBytes(2).toString("hex")}`;
const ADMIN_EMAIL = `admin-e2e-${sufixo}@teste-ceasapro.com.br`;
const ADMIN_SENHA = "admin-e2e-1234";

/** Raiz comum dos dados deste arquivo — usada só para a limpeza no fim. */
const MARCA = `ZZE2E${sufixo}`;

/**
 * Prefixo dos três usuários de acompanhamento, DISTINTO do usado pelos testes de
 * notificação.
 *
 * Os testes de notificação criam empresas (cadastro público e formulário do
 * painel), e elas nascem inadimplentes. Com um prefixo só, a busca da tela de
 * usuários traria essas empresas também, e os contadores deixariam de fechar
 * conforme a ordem dos testes — falha intermitente, do tipo que se culpa o
 * "teste instável" em vez de ler.
 */
const MARCA_ACOMP = `${MARCA}ACOMP`;

const dias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const criados = { tenants: [] as string[], usuarios: [] as string[], planos: [] as string[] };

async function empresaComUsuario(opts: {
  nome: string;
  status: "TRIAL" | "ATIVO" | "VENCIDA";
  online?: boolean;
  planId: string;
}) {
  const tenant = await prisma.tenant.create({
    data: {
      tradeName: `${MARCA_ACOMP} ${opts.nome}`,
      status: "ACTIVE",
      onboardingCompletedAt: new Date(),
    },
  });
  criados.tenants.push(tenant.id);

  await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      planId: opts.planId,
      status: opts.status === "VENCIDA" ? "ATIVO" : opts.status,
      monthlyAmount: 49.9,
      // Só quem paga tem `activatedAt`; em teste ele é nulo, e é isso que faz
      // `computeStatus` devolver TRIAL.
      activatedAt: opts.status === "TRIAL" ? null : new Date("2026-01-10T00:00:00Z"),
      trialEndsAt: opts.status === "TRIAL" ? dias(4) : null,
      // VENCIDA passa da tolerância de 5 dias: o status gravado continua ATIVO
      // (o cron não rodou), e a tela tem de classificar pela data.
      currentPeriodEnd: opts.status === "VENCIDA" ? dias(-40) : dias(10),
      graceDays: 5,
    },
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: `${MARCA_ACOMP} ${opts.nome}`,
      email: `${MARCA_ACOMP.toLowerCase()}-${opts.nome.toLowerCase()}@teste.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });

  if (opts.online) {
    // Sessão viva renovada agora — é o sinal de presença que a tela usa.
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: randomBytes(24).toString("hex"),
        expiresAt: dias(30),
      },
    });
  }

  return { tenantId: tenant.id, userId: user.id };
}

async function entrarComoAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(ADMIN_EMAIL);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN_SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

test.beforeAll(async () => {
  await prisma.user.create({
    data: {
      tenantId: null,
      name: "Admin E2E",
      email: ADMIN_EMAIL,
      passwordHash: await hash(ADMIN_SENHA, ARGON),
      role: "SUPER_ADMIN",
      active: true,
      mustChangePassword: false,
    },
  });
  criados.usuarios.push(
    (await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true } }))
      .id,
  );

  // O cadastro é limitado por IP e todas as execuções locais saem do mesmo IP.
  await prisma.rateLimit.deleteMany({});

  // A campainha conta TODAS as não lidas. Zerar aqui é o que permite afirmar o
  // número exato depois; o banco de teste é descartável.
  await prisma.adminNotification.deleteMany({});

  const plano = await prisma.plan.create({
    data: {
      name: `Plano ${MARCA}`,
      slug: `plano-${MARCA.toLowerCase()}`,
      priceMonthly: 49.9,
      active: true,
    },
  });
  criados.planos.push(plano.id);

  await empresaComUsuario({ nome: "Testando", status: "TRIAL", online: true, planId: plano.id });
  await empresaComUsuario({ nome: "Pagando", status: "ATIVO", planId: plano.id });
  await empresaComUsuario({ nome: "Devendo", status: "VENCIDA", planId: plano.id });
});

test.afterAll(async () => {
  try {
    // Pelo PREFIXO, não pela lista do `beforeAll`: os próprios testes criam
    // empresas (o cadastro público e o formulário do painel), e essas não estão
    // em `criados`. Deixá-las no banco somaria a cada execução da suíte.
    const doTeste = await prisma.tenant.findMany({
      where: { tradeName: { startsWith: MARCA } },
      select: { id: true },
    });
    const ids = [...new Set([...criados.tenants, ...doTeste.map((t) => t.id)])];

    await prisma.adminNotification.deleteMany({});
    // Ordem pelas FKs: o que aponta para user/tenant sai antes deles.
    await prisma.refreshToken.deleteMany({ where: { user: { tenantId: { in: ids } } } });
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.expenseCategory.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.packagingType.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });

    await prisma.refreshToken.deleteMany({ where: { userId: { in: criados.usuarios } } });
    await prisma.user.deleteMany({ where: { id: { in: criados.usuarios } } });
    await prisma.plan.deleteMany({ where: { id: { in: criados.planos } } });
  } finally {
    await prisma.$disconnect();
  }
});

test.describe("Notificações do painel", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("cadastro pelo site chega na campainha e pode ser marcado como lido", async ({ page }) => {
    const email = `lead-${sufixo}@teste-ceasapro.com.br`;

    // Cadastro público de verdade, pela API. A resposta é genérica por design
    // (anti-enumeração), então o que se observa é o efeito no painel.
    const res = await page.request.post("/api/auth/signup", {
      data: {
        tradeName: `${MARCA} Lead`,
        email,
        password: "senha1234",
        phone: "31999990000",
      },
    });
    expect(res.status()).toBe(200);

    await entrarComoAdmin(page);

    // A campainha mostra o número sem que o admin precise ir procurar.
    const campainha = page.getByRole("link", { name: "Notificações (1 não lida)" });
    await expect(campainha).toBeVisible();

    await campainha.click();
    await expect(page).toHaveURL(/\/admin\/notificacoes/);
    await expect(page.getByText(/Novo cadastro pelo site/i)).toBeVisible();
    await expect(page.getByText(email, { exact: false })).toBeVisible();
    // O texto não pode prometer que a empresa já está testando: o teste só
    // começa quando ela confirma o e-mail.
    await expect(page.getByText(/confirmar o e-mail/i)).toBeVisible();
    // Enquanto há aviso não lido, a campainha NUNCA aparece sem contagem.
    await expect(page.getByRole("link", { name: "Notificações", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Marcar como lida" }).click();

    // A contagem do cabeçalho é renderizada no servidor: se a tela só mexesse no
    // estado local, o número continuaria "1" aqui.
    await expect(page.getByRole("link", { name: "Notificações", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Marcar como lida" })).toHaveCount(0);

    // Lida continua na caixa (é histórico), mas sai do filtro de não lidas.
    await expect(page.getByText(/Novo cadastro pelo site/i)).toBeVisible();
    await page.getByRole("link", { name: "Não lidas" }).click();
    await expect(page.getByText("Nenhum aviso não lido")).toBeVisible();
  });

  test("empresa cadastrada pelo painel também vira aviso", async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto("/admin/notificacoes");
    // Título EXATO: o corpo do aviso também contém "cadastrada pelo painel"
    // ("...foi cadastrada pelo painel administrativo"), então um padrão solto
    // casaria duas vezes por aviso e a contagem não fecharia.
    const titulo = page.getByText("Empresa cadastrada pelo painel", { exact: true });
    const antes = await titulo.count();

    await page.goto("/admin/clientes/novo");
    await page.getByLabel("Nome da empresa (fantasia)").fill(`${MARCA} Pelo Painel`);
    await page.getByLabel("Nome", { exact: true }).fill("Dono Painel");
    await page
      .getByLabel("E-mail", { exact: true })
      .fill(`painel-${sufixo}@teste-ceasapro.com.br`);
    await page.getByRole("button", { name: "Criar empresa" }).click();

    // Espera a confirmação antes de sair da tela: navegar durante a server
    // action em voo a cancelaria, e o teste falharia por corrida, não por
    // defeito. Também confirma que o cadastro pelo painel continua funcionando
    // depois da mudança no retorno da transação de `createTenantWithOwner`.
    await expect(page.getByText("Empresa criada com sucesso!")).toBeVisible();

    await page.goto("/admin/notificacoes");
    await expect(titulo).toHaveCount(antes + 1);
  });
});

test.describe("Acompanhamento de usuários", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * A lista de usuários, e só ela.
   *
   * O escopo não é preciosismo: "Online", "Em teste" e "Pagamento em dia" são ao
   * mesmo tempo texto de crachá, rótulo de KPI e nome de botão de filtro. Sem
   * delimitar a lista, um `getByText` casa os três e o teste passa (ou falha)
   * por motivo errado.
   */
  const lista = (page: import("@playwright/test").Page) =>
    page.getByRole("list", { name: "Usuários" });
  const cartoes = (page: import("@playwright/test").Page) =>
    lista(page).getByRole("listitem");

  test("mostra quem está online e como está o pagamento de cada empresa", async ({ page }) => {
    await entrarComoAdmin(page);
    // A busca isola os dados deste teste: sem ela os contadores e a lista
    // trariam o banco inteiro e nada poderia ser afirmado com exatidão.
    await page.goto(`/admin/usuarios?q=${encodeURIComponent(MARCA_ACOMP)}`);

    // Os três estados que o painel precisa distinguir.
    await expect(lista(page).getByText("Online", { exact: true })).toHaveCount(1);
    await expect(lista(page).getByText("Em teste · 4 dia(s)")).toBeVisible();
    await expect(lista(page).getByText("Pagamento em dia", { exact: true })).toBeVisible();
    // Passou da tolerância: já sem acesso, e o status gravado ainda dizia ATIVO.
    await expect(lista(page).getByText("Inadimplente", { exact: true })).toBeVisible();

    // Os contadores existem e trazem a definição de "online" à vista — sem ela
    // "online" seria uma afirmação que ninguém sabe interpretar.
    await expect(page.getByText("Online agora")).toBeVisible();
    await expect(page.getByText(/Sessão ativa nos últimos \d+ min/)).toBeVisible();
  });

  test("os filtros recortam a lista", async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto(`/admin/usuarios?q=${encodeURIComponent(MARCA_ACOMP)}`);

    const total = await cartoes(page).count();
    expect(total).toBeGreaterThanOrEqual(3);

    await page.getByRole("link", { name: "Em teste" }).click();
    await expect(lista(page).getByText("Em teste · 4 dia(s)")).toBeVisible();
    await expect(lista(page).getByText("Pagamento em dia", { exact: true })).toHaveCount(0);
    // O filtro preserva a busca: sem isso a lista voltaria ao banco inteiro.
    await expect(page).toHaveURL(new RegExp(`q=${MARCA_ACOMP}`));

    await page.getByRole("link", { name: "Inadimplentes" }).click();
    await expect(lista(page).getByText("Inadimplente", { exact: true })).toBeVisible();
    await expect(lista(page).getByText(/^Em teste/)).toHaveCount(0);

    await page.getByRole("link", { name: "Online" }).click();
    await expect(cartoes(page)).toHaveCount(1);
    await expect(lista(page).getByText("Online", { exact: true })).toHaveCount(1);

    await page.getByRole("link", { name: "Todos" }).click();
    await expect(cartoes(page)).toHaveCount(total);
  });
});

test.describe("Painel em tela estreita (320px)", () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 320, height: 720 },
  });

  /**
   * O painel usa os MESMOS cartões de número das telas do cliente, mas em outra
   * disposição (4 + 2 colunas em Usuários) e com crachás ao lado do nome. Basta
   * um rótulo comprido para o crachá ser empurrado para fora, então vale medir
   * aqui também em vez de assumir que o componente resolve sozinho.
   */
  for (const url of ["/admin", "/admin/usuarios", "/admin/notificacoes"]) {
    test(`nada vaza dos cartões em ${url}`, async ({ page }) => {
      await entrarComoAdmin(page);
      await page.goto(url);
      await expect(page.locator("main")).toBeVisible();

      const problemas = await vazamentos(page);
      expect(problemas, `${url}: ${JSON.stringify(problemas, null, 2)}`).toEqual([]);
    });
  }
});
