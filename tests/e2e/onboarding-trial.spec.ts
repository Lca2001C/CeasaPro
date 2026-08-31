import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

/**
 * Fluxo de aquisição de ponta a ponta: landing → cadastro → confirmação →
 * teste grátis → banner de fim de teste → bloqueio com 402.
 *
 * Roda com sessão própria e com o CSP ativo. É aqui que o 402 é provado de
 * verdade: com servidor real, cookie real e o guard de rota real. Os testes de
 * integração cobrem a regra; este cobre o caminho.
 *
 * O token de confirmação não pode ser lido do banco (guardamos só o SHA-256, por
 * design). Então o teste GERA um token e grava o hash dele — do ponto de vista da
 * aplicação é indistinguível do que foi enviado por e-mail.
 */

const prisma = new PrismaClient();

const sufixo = `${Date.now()}${randomBytes(2).toString("hex")}`;
const EMAIL = `e2e-trial-${sufixo}@teste-ceasapro.com.br`;
const SENHA = "senha1234";
const NEGOCIO = `Hortifruti E2E ${sufixo}`;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const emDias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function tenantDoTeste() {
  const user = await prisma.user.findFirst({
    where: { email: EMAIL },
    select: { id: true, tenantId: true },
  });
  return user;
}

/**
 * Zera as janelas de rate limit antes de começar.
 *
 * O cadastro é limitado a 5 por hora POR IP, e num teste local todas as
 * execuções saem do mesmo IP. Rodar a suíte algumas vezes na mesma hora — ou
 * testar o fluxo à mão antes — esgotava o limite, e a falha aparecia como um
 * timeout na espera pela empresa, sem nenhuma pista de que o limite era a causa.
 *
 * O banco de teste é descartável (a trava `guard-database` só permite host
 * local), então apagar os contadores aqui é seguro e torna o teste independente
 * do que rodou antes dele.
 */
test.beforeAll(async () => {
  await prisma.rateLimit.deleteMany({});
});

test.afterAll(async () => {
  const user = await tenantDoTeste();
  if (user?.tenantId) {
    const id = user.tenantId;
    await prisma.auditLog.deleteMany({ where: { tenantId: id } });
    await prisma.expenseCategory.deleteMany({ where: { tenantId: id } });
    await prisma.packagingType.deleteMany({ where: { tenantId: id } });
    // Usuário e assinatura caem por cascade.
    await prisma.tenant.deleteMany({ where: { id } });
  }
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

test.describe("Onboarding com teste grátis de 7 dias", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("da landing ao bloqueio por fim de teste", async ({ page }) => {
    // ─── 1. Landing pública ───
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("CEASA");
    // Preços vêm do banco: se a seção existe, a leitura pública funcionou.
    await expect(page.getByRole("heading", { name: "Planos" })).toBeVisible();

    await page.getByRole("link", { name: /Testar 7 dias grátis/i }).first().click();
    await expect(page).toHaveURL(/\/cadastro/);

    // ─── 2. Cadastro ───
    await page.getByLabel("Nome do seu negócio").fill(NEGOCIO);
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Telefone / WhatsApp").fill("(31) 99999-9999");
    await page.getByLabel(/Tipo de estabelecimento/).fill("Box 42");
    // `exact` é obrigatório: "Confirmar senha" também contém "Senha", e sem isso
    // o seletor casa com dois campos e o teste quebra por ambiguidade.
    await page.getByLabel("Senha", { exact: true }).fill(SENHA);

    // Senhas divergentes não passam — e nada é criado.
    await page.getByLabel("Confirmar senha").fill(SENHA + "-diferente");
    await page.getByRole("button", { name: /Criar conta/i }).click();
    await expect(page.getByText("As senhas não conferem")).toBeVisible();
    await expect(page.getByText("Verifique seu e-mail")).toHaveCount(0);

    // Corrigindo a confirmação, o cadastro segue.
    await page.getByLabel("Confirmar senha").fill(SENHA);
    await page.getByRole("button", { name: /Criar conta/i }).click();

    await expect(page.getByText("Verifique seu e-mail")).toBeVisible();

    // O cadastro roda em `after()`, depois da resposta: espera a empresa existir.
    await expect
      .poll(async () => (await tenantDoTeste())?.tenantId ?? null, { timeout: 15_000 })
      .not.toBeNull();

    const user = (await tenantDoTeste())!;
    const tenantId = user.tenantId!;

    // Antes de confirmar, nada de acesso.
    let sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe("SUSPENSO");
    expect(sub?.trialEndsAt).toBeNull();

    // ─── 3. Confirmação do e-mail ───
    const token = randomBytes(32).toString("base64url");
    await prisma.user.update({
      where: { id: user.id },
      data: { verifyTokenHash: sha256(token), verifyTokenExpiresAt: emDias(1) },
    });

    await page.goto(`/cadastro/confirmar/${token}`);
    await expect(page.getByText("E-mail confirmado!")).toBeVisible();

    sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe("TRIAL");
    expect(sub?.trialEndsAt).not.toBeNull();

    // ─── 4. Entrar e usar o sistema ───
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();

    // Empresa nova cai no onboarding guiado antes do dashboard.
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15_000 });
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { onboardingCompletedAt: new Date() },
    });

    await page.goto("/dashboard");
    await expect(page.locator("aside")).toBeVisible();
    // Com 7 dias inteiros pela frente o banner fica calado.
    await expect(page.getByText(/teste grátis termina/i)).toHaveCount(0);

    // ─── 5. Banner na reta final ───
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { trialEndsAt: emDias(1) },
    });
    await page.goto("/dashboard");
    await expect(page.getByText(/teste grátis termina/i)).toBeVisible();

    // ─── 6. Teste expirado → bloqueio ───
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { trialEndsAt: emDias(-1), status: "TRIAL" },
    });

    // O `subStatus` viaja no JWT: o token atual ainda diz TRIAL até expirar (15
    // min) ou ser renovado. `/api/auth/refresh` recalcula e reemite — é o mesmo
    // caminho que faz o bloqueio propagar em produção.
    const refresh = await page.request.post("/api/auth/refresh", { data: {} });
    expect(refresh.ok()).toBeTruthy();

    // API protegida responde 402 Payment Required.
    const api = await page.request.post("/api/vendas", { data: {} });
    expect(api.status()).toBe(402);

    // E a navegação vai para a tela de regularização, com o texto do fim do teste.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/conta\/suspensa/);
    await expect(page.getByText("Seu teste grátis terminou")).toBeVisible();
    await expect(page.getByRole("link", { name: /Escolher plano/i })).toBeVisible();
  });
});
