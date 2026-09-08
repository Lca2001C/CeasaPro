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

    // ─── 2. Cadastro: e-mail, senha e dois seletores ───
    await page.getByLabel("E-mail").fill(EMAIL);
    // Os campos de DIGITAÇÃO (negócio, telefone, tipo de estabelecimento) saíram
    // daqui e foram para Configurações. Estado e central ficam, mas como
    // `<select>` — um toque cada, não uma linha para preencher.
    await expect(page.getByLabel("Nome do seu negócio")).toHaveCount(0);
    await expect(page.getByLabel("Telefone / WhatsApp")).toHaveCount(0);

    // A lista de centrais só abre depois do estado: são ~65 no país, e uma lista
    // única seria impossível de percorrer no celular.
    await expect(page.getByLabel(/Onde você compra/)).toBeDisabled();
    await page.getByLabel("Estado").selectOption("MG");
    await expect(page.getByLabel(/Onde você compra/)).toBeEnabled();
    await page.getByLabel(/Onde você compra/).selectOption("CEAMG");

    // Trocar de estado precisa LIMPAR a central: sem isso o cadastro enviaria
    // uma central de outro estado, que o servidor aceitaria (ela existe) e o
    // cliente veria os preços da praça errada.
    await page.getByLabel("Estado").selectOption("SP");
    await expect(page.getByLabel(/Onde você compra/)).toHaveValue("");
    await page.getByLabel("Estado").selectOption("MG");
    await page.getByLabel(/Onde você compra/).selectOption("CEAMG");
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

    // Entra DIRETO no sistema. Este é o coração da mudança: antes o layout
    // redirecionava para `/onboarding` enquanto `onboardingCompletedAt` fosse
    // nulo, e o teste tinha de marcar a coluna à mão para seguir. O wizard virou
    // convite, então o `UPDATE` saiu junto — se o redirecionamento voltar, isto
    // reprova.
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/onboarding/);

    await expect(page.locator("aside")).toBeVisible();
    // Com 7 dias inteiros pela frente o banner fica calado.
    await expect(page.getByText(/teste grátis termina/i)).toHaveCount(0);

    // ─── 4b. O cadastro está incompleto, e o sistema diz isso ───
    await expect(page.getByText(/Complete o cadastro da sua empresa/i)).toBeVisible();
    // Sem nome, o topo mostra o valor de partida.
    await expect(page.locator("header")).toContainText("Minha empresa");

    /*
      ─── 4c. O que foi escolhido no cadastro FICOU GRAVADO ───

      Conferido no banco, e não na tela de Cotações, por um motivo que vale
      registrar: o cadastro público entra no plano ATIVO MAIS BARATO, e esse
      plano não inclui módulos opcionais. Ou seja, quem acaba de se cadastrar
      escolhe a central mas ainda não tem acesso ao módulo — ele passa a
      funcionar no instante em que a pessoa contrata um plano que o inclua.

      O dado chegar ao seu lugar é o que este passo prova. Que a TELA abre com a
      praça certa está provado em `tests/integration/cadastro-uf-central.test.ts`,
      onde o plano é controlado.
    */
    const empresa = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { uf: true, ceasaCentralCode: true },
    });
    expect(empresa.uf).toBe("MG");
    expect(empresa.ceasaCentralCode).toBe("CEAMG");

    // ─── 4d. Completar em Configurações é o caminho prometido ───
    await page.goto("/configuracoes");
    // A UF veio do cadastro e aparece preenchida.
    await expect(page.getByLabel("Estado")).toHaveValue("MG");
    await page.getByLabel("Nome fantasia").fill(NEGOCIO);
    await page.getByLabel(/Tipo de estabelecimento/).fill("Box 42");
    // `exact` é obrigatório: a aba tem também "Salvar central", o seletor de
    // central do CEASA — que aparece justamente porque esta empresa escolheu uma
    // no cadastro, mesmo sem ter o módulo no plano. Sem `exact`, o clique fica
    // ambíguo entre os dois botões.
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Dados atualizados")).toBeVisible();

    // E o dono CONSEGUE mexer na central que ele mesmo informou, ainda sem o
    // módulo: sem isso, quem escolhesse a praça errada no cadastro ficaria preso
    // com ela até contratar Cotações.
    await expect(page.getByLabel("Sua central do CEASA")).toHaveValue("CEAMG");

    await page.goto("/dashboard");
    await expect(page.locator("header")).toContainText(NEGOCIO);

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
