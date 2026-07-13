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
