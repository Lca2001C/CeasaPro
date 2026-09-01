import { test as setup, expect } from "@playwright/test";

const authFile = "tests/e2e/.auth/user.json";

/** Faz login como a empresa demo e salva a sessão para os demais testes. */
setup("autenticar como empresa demo", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("demo@ceasapro.com.br");
  await page.getByLabel("Senha").fill("demo123");
  await page.getByRole("button", { name: "Entrar" }).click();

  await page.waitForURL("**/dashboard", { timeout: 15_000 });

  // O convite de instalação do PWA abre na primeira tela pós-login e é MODAL:
  // ele marca o resto da página como aria-hidden, então nada mais é "visível"
  // até ser fechado. Dispensar aqui resolve os dois lados: confirma que o
  // convite aparece, e grava o "Agora não" no storageState — assim os demais
  // testes autenticados não tropeçam nele. O comportamento do convite em si é
  // coberto por `pwa-install.spec.ts`, que usa sessão limpa.
  await page.getByRole("button", { name: "Agora não" }).click();

  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
