import { test, expect } from "@playwright/test";

// Testes públicos (sem sessão).
test.describe("Autenticação e proteção de rotas", () => {
  test("rota protegida sem login redireciona para /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel("E-mail")).toBeVisible();
  });

  test("credenciais inválidas mostram erro e não entram", async ({ page }) => {
    await page.goto("/login");
    // E-mail único por execução para não consumir o rate limit da conta demo.
    await page.getByLabel("E-mail").fill(`naoexiste_${Date.now()}@ceasapro.com.br`);
    await page.getByLabel("Senha").fill("senhaerrada");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByText(/incorretos|inválid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("botão de Google está na tela e o callback sem state volta ao login", async ({
    page,
    request,
  }) => {
    await page.goto("/login");
    const google = page.getByRole("link", { name: "Entrar com Google" });
    await expect(google).toBeVisible();
    await expect(google).toHaveAttribute("href", "/api/auth/google");

    await page.goto("/cadastro");
    await expect(page.getByRole("link", { name: "Entrar com Google" })).toBeVisible();

    // Sem cookie de state o callback não troca code com o Google — cai no login.
    const res = await request.get("/api/auth/google/callback?code=x&state=y", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    const location = res.headers()["location"] ?? "";
    // Sem cookie de state: `google-falhou`. Sem GOOGLE_CLIENT_* no .env:
    // o callback nem chega a validar o state e avisa `google-indisponivel`.
    expect(location).toMatch(/\/login\?erro=google-(falhou|indisponivel)/);
  });

  test("iniciar Google redireciona para o Google quando as credenciais existem", async ({
    request,
  }) => {
    const res = await request.get("/api/auth/google", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()["location"] ?? "";
    // Com GOOGLE_CLIENT_* no CI: vai para accounts.google.com.
    // Sem elas (dev local sem env): volta ao login avisando.
    expect(
      location.includes("accounts.google.com") || location.includes("erro=google-indisponivel"),
    ).toBeTruthy();
  });
});

test.describe("Esqueci minha senha", () => {
  test("do login até a confirmação de envio", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Esqueci minha senha" }).click();
    await expect(page).toHaveURL(/\/recuperar-senha/);

    // E-mail único por execução: não queima o rate limit por e-mail (3 / 15 min).
    const email = `recuperar_${Date.now()}@ceasapro.com.br`;
    await page.getByLabel("E-mail da conta").fill(email);
    await page.getByRole("button", { name: "Enviar link" }).click();

    // Resposta genérica: a tela é a mesma para e-mail existente e inexistente.
    await expect(page.getByText("Verifique seu e-mail")).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  test("link inválido não mostra formulário de senha", async ({ page }) => {
    await page.goto(`/recuperar-senha/${"a".repeat(43)}`);

    await expect(page.getByText("Link inválido ou expirado")).toBeVisible();
    await expect(page.getByLabel("Nova senha")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Pedir um link novo" })).toBeVisible();
  });
});

test.describe("Sitemap e robots (Google Search Console)", () => {
  test("sitemap.xml é público e lista só as páginas de aquisição", async ({ request }) => {
    const res = await request.get("/sitemap.xml", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<urlset");
    expect(body).toContain("/cadastro");
    expect(body).toContain("/login");
    expect(body).toContain("/termos");
    expect(body).toContain("/privacidade");
    expect(body).not.toContain("/dashboard");
    expect(body).not.toContain("/admin");
  });

  test("robots.txt é público e aponta o sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toMatch(/Disallow:\s*\/dashboard/i);
    expect(body).toMatch(/Sitemap:\s*.*\/sitemap\.xml/i);
  });

  test("página inicial tem a metatag de verificação do Google no <head>", async ({ request }) => {
    const res = await request.get("/", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(
      'name="google-site-verification" content="Ot8CbUdqquSApG960z4a2BMiH-mCUNWZj5uFkbqpxkM"',
    );
  });
});
