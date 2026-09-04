import { test, expect } from "@playwright/test";

/**
 * O logout é caminho crítico de autenticação e estava sem cobertura.
 *
 * O que importa aqui não é só cair em /login: é que a sessão morra de verdade.
 * O botão dispara um POST em /api/auth/logout (que revoga o refresh token e
 * limpa os cookies) e navega com um DOCUMENTO NOVO — ver `lib/session-nav.ts`.
 * Se alguém trocar isso por `router.push()`, o cache RSC do cliente sobrevive e
 * o "voltar" do navegador volta a mostrar tela protegida: é essa regressão que
 * o último passo deste teste pega.
 *
 * Sessão própria em vez da compartilhada: sair revoga o refresh token no banco,
 * e não queremos que este teste interfira nos outros, que rodam com a mesma
 * sessão salva. Login bem-sucedido zera o próprio contador de rate limit, então
 * este login extra não custa janela.
 *
 * O estado vazio precisa ser EXPLÍCITO: `storageState: undefined` significa
 * "não especificado" e cai de volta no valor do projeto — a sessão sobrevivia, o
 * proxy redirecionava /login para /dashboard e o campo de e-mail nunca aparecia.
 */
test.describe("Logout", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("encerra a sessão e não deixa voltar para tela protegida", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("demo@ceasapro.com.br");
    await page.getByLabel("Senha").fill("demo123");
    await page.getByRole("button", { name: "Entrar" }).click();

    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    // O convite de instalação do PWA abre na primeira tela pós-login e é MODAL:
    // sem fechá-lo, o botão "Sair" fica coberto. As regras dele são cobertas por
    // `pwa-install.spec.ts`; aqui ele é só um passo do caminho.
    await page.getByRole("button", { name: "Agora não" }).click();

    await expect(page.locator("aside")).toBeVisible();
    await expect(page.locator("header").getByRole("button", { name: "Sair" })).toHaveCount(0);
    await expect(page.locator("aside").getByRole("button", { name: "Sair" })).toBeVisible();

    await page.getByRole("button", { name: "Sair" }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel("E-mail")).toBeVisible();

    // A sessão acabou: pedir a rota protegida de novo tem de voltar ao login.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("aside")).toHaveCount(0);
  });
});
