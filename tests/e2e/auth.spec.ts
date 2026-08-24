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
