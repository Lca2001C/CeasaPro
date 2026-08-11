import { test as setup, expect } from "@playwright/test";

const authFile = "tests/e2e/.auth/user.json";

/** Faz login como a empresa demo e salva a sessão para os demais testes. */
setup("autenticar como empresa demo", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("demo@ceasapro.com.br");
  await page.getByLabel("Senha").fill("demo123");
  await page.getByRole("button", { name: "Entrar" }).click();

  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
