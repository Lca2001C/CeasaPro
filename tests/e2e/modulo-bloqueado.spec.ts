import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";

/**
 * Módulo fora do plano — a barreira que sustenta a receita.
 *
 * Esconder o item do menu é UX; a barreira é do servidor. O que se prova aqui é
 * que digitar a URL direta NÃO entrega a tela: o cliente é levado à página de
 * plano, sabendo qual recurso está faltando.
 *
 * A empresa é PRÓPRIA deste arquivo, com o plano básico (`features.modules: []`).
 * Mexer no plano da demo faria os outros specs — que contam com os módulos
 * ligados — falharem conforme a ordem de execução.
 */

const prisma = new PrismaClient();

test.use({ storageState: { cookies: [], origins: [] } });

const SUFIXO = randomBytes(4).toString("hex");
const EMAIL = `basico-${SUFIXO}@teste-ceasapro.com.br`;
const SENHA = "basico-e2e-1234";
const EMPRESA = `ZZBASICO ${SUFIXO}`;

let tenantId = "";
let userId = "";

test.beforeAll(async () => {
  // O plano `basico` do seed é o que NÃO inclui nenhum módulo opcional.
  const plano = await prisma.plan.findFirstOrThrow({ where: { slug: "basico" } });

  const tenant = await prisma.tenant.create({
    data: { tradeName: EMPRESA, status: "ACTIVE", onboardingCompletedAt: new Date() },
  });
  tenantId = tenant.id;

  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: plano.id,
      status: "ATIVO",
      monthlyAmount: plano.priceMonthly,
      // Já pagante: o bloqueio que se quer medir é o de MÓDULO, não o de
      // cobrança. Sem `activatedAt` o acesso cairia em `/conta/suspensa` e o
      // teste passaria pelo motivo errado.
      activatedAt: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      graceDays: 5,
    },
  });

  const user = await prisma.user.create({
    data: {
      tenantId,
      name: "Dono do plano básico",
      email: EMAIL,
      passwordHash: await hash(SENHA, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      role: "OWNER",
    },
  });
  userId = user.id;
});

test.afterAll(async () => {
  await prisma.tenantSubscription.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

async function entrar(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha", { exact: true }).fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  // O convite de instalação do PWA é modal no primeiro login.
  const agoraNao = page.getByRole("button", { name: "Agora não" });
  if (await agoraNao.count()) await agoraNao.click();
}

test.describe("Módulo fora do plano", () => {
  test("o menu não oferece os módulos que o plano não inclui", async ({ page }) => {
    await entrar(page);
    const side = page.locator("aside");
    for (const item of ["Cotações", "Caixas plásticas", "Higienização", "Embalagens"]) {
      await expect(side.getByRole("link", { name: item, exact: true })).toHaveCount(0);
    }
    // E o que é núcleo continua lá — o bloqueio é do módulo, não da conta.
    await expect(side.getByRole("link", { name: "Vendas", exact: true })).toBeVisible();
  });

  test("a URL direta leva ao plano, dizendo qual recurso falta", async ({ page }) => {
    /*
      É a barreira que importa: esconder o link não impede ninguém de digitar o
      endereço, e sem o gate de servidor o módulo pago ficaria acessível a quem
      não pagou.
    */
    await entrar(page);
    await page.goto("/cotacoes");
    await expect(page).toHaveURL(/\/plano\?bloqueado=cotacoes/);
    await expect(page.getByRole("heading", { name: "Meu plano" })).toBeVisible();
  });

  test("relatório avançado também cai no plano, e o básico abre", async ({ page }) => {
    await entrar(page);

    // Avançado (lucro por produto) exige `relatorios_avancados`.
    await page.goto("/relatorios/lucro_produto");
    await expect(page).toHaveURL(/\/plano\?bloqueado=relatorios_avancados/);

    // O básico continua disponível: o plano não some, ele encolhe.
    await page.goto("/relatorios/vendas");
    await expect(page).toHaveURL(/\/relatorios\/vendas/);
  });
});
