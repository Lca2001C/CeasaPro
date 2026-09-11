import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";

/**
 * Onboarding — os três passos do primeiro acesso.
 *
 * `onboarding-trial.spec.ts` cobre o CAMINHO até aqui (cadastro público,
 * confirmação de e-mail, início do teste grátis) e o bloqueio no fim do trial.
 * O que faltava é o wizard em si: confirmar os dados da empresa, poder PULAR
 * fornecedor e produto, e sair com `onboardingCompletedAt` gravado.
 *
 * O wizard NÃO é mais obrigatório: o `redirect("/onboarding")` saiu do layout —
 * com o cadastro pedindo só e-mail e senha, forçá-lo seria trocar um formulário
 * longo por outro. Hoje é CONVITE, pelo cartão "Complete o cadastro" no Início,
 * e `onboardingCompletedAt` passou a significar "o convite já foi resolvido".
 * O teste entra por esse caminho, que é o do usuário.
 *
 * E a regressão da auditoria de 08/set: o passo 1 chegou a APAGAR telefone e
 * CNPJ já cadastrados, porque salvava os campos vazios do formulário por cima do
 * que o cadastro havia gravado. Aqui o telefone é conferido depois de concluir.
 */

const prisma = new PrismaClient();

test.use({ storageState: { cookies: [], origins: [] } });

const SUFIXO = randomBytes(4).toString("hex");
const MARCA = `ZZONB${SUFIXO}`;
const EMAIL = `onb-${SUFIXO}@teste-ceasapro.com.br`;
const SENHA = "onb-e2e-1234";
const NOME_EMPRESA = `${MARCA} Hortifruti`;
const TELEFONE = "31988881111";

let tenantId = "";

test.beforeAll(async () => {
  const plano = await prisma.plan.findFirstOrThrow({ where: { active: true } });

  // Empresa recém-criada: onboarding AINDA NÃO concluído é o que leva ao wizard.
  const tenant = await prisma.tenant.create({
    data: { tradeName: MARCA, status: "ACTIVE", onboardingCompletedAt: null },
  });
  tenantId = tenant.id;

  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: plano.id,
      status: "ATIVO",
      monthlyAmount: plano.priceMonthly,
      activatedAt: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      graceDays: 5,
    },
  });

  await prisma.user.create({
    data: {
      tenantId,
      name: "Dono novo",
      email: EMAIL,
      passwordHash: await hash(SENHA, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      role: "OWNER",
    },
  });
});

test.afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.product.deleteMany({ where: { tenantId } });
  await prisma.supplier.deleteMany({ where: { tenantId } });
  await prisma.expenseCategory.deleteMany({ where: { tenantId } });
  await prisma.packagingType.deleteMany({ where: { tenantId } });
  await prisma.tenantSubscription.deleteMany({ where: { tenantId } });
  await prisma.refreshToken.deleteMany({ where: { user: { tenantId } } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

test.describe("Onboarding do primeiro acesso", () => {
  test("confirma a empresa, pula fornecedor e produto e chega ao Início", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    /*
      Nada de clicar "Agora não" aqui.

      O convite de instalar o PWA nem aparece para esta empresa — o layout só o
      mostra depois que o convite de cadastro foi resolvido. O único "Agora não"
      da tela é o DO PRÓPRIO CARTÃO, e clicá-lo dispensaria o convite (marcando
      `onboardingCompletedAt`) e levaria embora o caminho que se quer testar.
    */
    await expect(page.getByText("Complete o cadastro da sua empresa")).toBeVisible();
    await page.getByRole("link", { name: "Completar agora" }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });

    // Passo 1 — dados da empresa.
    await page.getByLabel("Nome da empresa").fill(NOME_EMPRESA);
    await page.getByLabel("Telefone da empresa").fill(TELEFONE);
    await page.getByRole("button", { name: "Continuar" }).click();

    // Passos 2 e 3 são OPCIONAIS: quem chega de madrugada com o box abrindo
    // precisa poder pular e cadastrar depois.
    await page.getByRole("button", { name: "Pular" }).first().click();
    await page.getByRole("button", { name: "Pular" }).first().click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    /*
      AGORA o convite de instalar o PWA aparece — e só agora: o layout o segura
      enquanto o cartão de cadastro está de pé, para não empilhar três pedidos na
      primeira tela. Ele é MODAL (marca o resto da página como `aria-hidden`),
      então nada mais é "visível" até ser dispensado.
    */
    await page.getByRole("button", { name: "Agora não" }).click();
    await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();

    /*
      O efeito que impede o wizard de voltar a cada login, e o telefone que o
      passo 1 chegou a apagar em produção.
    */
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.onboardingCompletedAt).not.toBeNull();
    expect(tenant.tradeName).toBe(NOME_EMPRESA);
    expect(tenant.phone).toBe(TELEFONE);
  });
});
