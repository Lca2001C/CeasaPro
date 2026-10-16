import { test, expect } from "@playwright/test";

/**
 * Tema escuro ("Ceasa à noite") de ponta a ponta: o script do `<head>` precisa
 * passar pela CSP (nonce) e pintar escuro ANTES da hidratação — senão a tela
 * pisca branca a cada carga, que é exatamente o que a escolha do tema promete
 * evitar.
 */

test.describe("tema escuro", () => {
  test("escolhido à mão, a página já nasce escura, sem bloqueio da CSP", async ({ page }) => {
    const bloqueios: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to execute/i.test(m.text())) bloqueios.push(m.text());
    });
    await page.addInitScript(() => localStorage.setItem("ceasapro-tema", "escuro"));

    // `domcontentloaded`: o HTML foi lido e o script do <head> rodou, mas o
    // React ainda pode não ter hidratado. Se aqui já é escuro, não houve flash.
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(fundo).toBe("rgb(11, 19, 15)"); // #0B130F, o galpão de madrugada

    // A barra do sistema acompanha o tema escolhido, mesmo com o sistema claro.
    await page.waitForLoadState("networkidle");
    const metas = await page
      .locator('meta[name="theme-color"]')
      .evaluateAll((ms) => ms.map((m) => m.getAttribute("content")));
    expect(metas.length).toBeGreaterThan(0);
    expect(new Set(metas)).toEqual(new Set(["#0B130F"]));
    expect(bloqueios).toEqual([]);
  });

  test("o seletor em Configurações troca e lembra a escolha", async ({ page }) => {
    await page.goto("/configuracoes");
    await page.getByRole("tab", { name: "Meu perfil" }).click();
    await page.getByRole("radio", { name: "Escuro" }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);

    await page.getByRole("tab", { name: "Meu perfil" }).click();
    await page.getByRole("radio", { name: "Claro" }).click();
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  });

  test("o atalho do menu também troca o tema", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ceasapro-tema", "claro"));
    await page.goto("/dashboard");
    const atalho = page.getByRole("button", { name: /Tema: Claro/ }).first();
    await atalho.click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });
});
