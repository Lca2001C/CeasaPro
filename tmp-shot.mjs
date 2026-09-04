import { chromium } from "@playwright/test";

const browser = await chromium.launch();
for (const largura of [320, 360]) {
  const ctx = await browser.newContext({
    storageState: "tests/e2e/.auth/user.json",
    viewport: { width: largura, height: 900 },
    locale: "pt-BR",
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/vendas/nova");
  await page.getByPlaceholder("Buscar produto...").fill("Tomate E2E");
  await page.getByRole("button", { name: /Tomate E2E/ }).first().click();
  await page.getByLabel("Preço de Tomate E2E").fill("1234,56");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `tmp-pdv-${largura}.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
console.log("ok");
