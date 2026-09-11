import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";

/**
 * Painel do super-admin: criar cliente e cortar o acesso dele.
 *
 * `admin-painel.spec.ts` cobre campainha e presença. O que faltava é a operação
 * que a plataforma existe para fazer: provisionar uma empresa (com OWNER e senha
 * temporária) e suspender quem parou de pagar. Suspender que não suspende é
 * receita perdida; suspender por engano é cliente parado no balcão.
 *
 * O super-admin é criado por este arquivo, e não lido do `.env`: a senha do seed
 * não está disponível no ambiente de teste, e depender dela deixaria o spec
 * verde ou vermelho conforme a máquina.
 */

const prisma = new PrismaClient();

test.use({ storageState: { cookies: [], origins: [] } });

const SUFIXO = randomBytes(4).toString("hex");
const ADMIN_EMAIL = `admin-cli-${SUFIXO}@teste-ceasapro.com.br`;
const ADMIN_SENHA = "admin-cli-1234";

/** Prefixo comum: a limpeza acha tudo mesmo se uma asserção falhar no meio. */
const MARCA = `ZZCLI${SUFIXO}`;
const EMPRESA = `${MARCA} Hortifruti`;
const OWNER_EMAIL = `owner-${SUFIXO}@teste-ceasapro.com.br`;

let adminId = "";

test.beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      name: "Operador de teste",
      email: ADMIN_EMAIL,
      passwordHash: await hash(ADMIN_SENHA, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      role: "SUPER_ADMIN",
    },
  });
  adminId = admin.id;
});

test.afterAll(async () => {
  const tenants = await prisma.tenant.findMany({
    where: { tradeName: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = tenants.map((t) => t.id);
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.adminNotification.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.expenseCategory.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.packagingType.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantSubscription.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { user: { tenantId: { in: ids } } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  await prisma.$disconnect();
});

async function entrar(page: import("@playwright/test").Page, email: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test.describe("Super-admin — clientes", () => {
  test("criar empresa com OWNER e depois suspender corta o acesso do dono", async ({ page }) => {
    await entrar(page, ADMIN_EMAIL, ADMIN_SENHA);
    await page.waitForURL(/\/admin/, { timeout: 15_000 });

    // 1. Provisionar a empresa.
    await page.goto("/admin/clientes/novo");
    await page.getByLabel("Nome da empresa (fantasia)").fill(EMPRESA);
    await page.getByLabel("Nome", { exact: true }).fill("Dono de teste");
    await page.getByLabel("E-mail", { exact: true }).fill(OWNER_EMAIL);
    await page.getByRole("button", { name: "Criar empresa" }).click();

    /*
      A senha temporária aparece na tela — é como o operador entrega o acesso ao
      cliente, e é a única vez que ela é visível. Sem isso, a empresa nasceria
      sem ninguém conseguir entrar nela.
    */
    await expect(page.getByText(/Empresa criada com sucesso/i)).toBeVisible();
    await expect(page.getByText(/Senha temporaria/i)).toBeVisible();
    const senhaTemp = (await page.locator("code").first().innerText()).trim();
    expect(senhaTemp.length).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Concluir" }).click();
    await page.waitForURL(/\/admin\/clientes$/, { timeout: 15_000 });
    await expect(page.getByText(EMPRESA)).toBeVisible();

    // 2. O dono entra com a senha temporária e é levado a trocá-la.
    const contextoDono = await page.context().browser()!.newContext();
    const dono = await contextoDono.newPage();
    await entrar(dono, OWNER_EMAIL, senhaTemp);
    await dono.waitForURL(/\/alterar-senha|\/dashboard|\/assinatura|\/conta/, {
      timeout: 15_000,
    });
    const urlAntes = dono.url();
    expect(urlAntes).not.toMatch(/\/login/);
    await contextoDono.close();

    // 3. O operador suspende a empresa.
    await page.getByText(EMPRESA).click();
    await page.waitForURL(/\/admin\/clientes\/[a-z0-9]+$/i, { timeout: 15_000 });
    await page.getByRole("button", { name: "Suspender" }).click();
    await expect(page.getByText(/Status atualizado/i)).toBeVisible();

    /*
      4. E o acesso do dono acaba.

      Suspender revoga as sessões da empresa, então não basta olhar a lista do
      admin: é a tela DO CLIENTE que tem de mudar. Um "suspenso" que não impede
      de usar é só um rótulo.
    */
    const contextoDepois = await page.context().browser()!.newContext();
    const donoDepois = await contextoDepois.newPage();
    await entrar(donoDepois, OWNER_EMAIL, senhaTemp);
    await donoDepois.waitForURL(/\/conta\/suspensa|\/assinatura|\/login/, { timeout: 15_000 });
    await expect(donoDepois).not.toHaveURL(/\/dashboard/);
    await contextoDepois.close();
  });
});
