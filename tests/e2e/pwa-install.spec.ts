import { test, expect } from "@playwright/test";

/**
 * Regras de exibição do convite de instalação (Fase 1 do PWA).
 *
 * O que se testa aqui são as REGRAS, não a instalação em si: `beforeinstallprompt`
 * não dispara em Chromium headless (o navegador só o emite quando considera o site
 * instalável), e no iOS não existe API alguma. A instalação nativa precisa de
 * verificação manual — ver o checklist em `docs/10-pwa-evolucao.md`.
 *
 * O que dá para provar de forma automatizada é justamente onde esse tipo de
 * componente erra: aparecer quando não devia, e insistir depois de um "não".
 */

const TITULO = "Use o CeasaPro como app no celular";
const DEMO = { email: "demo@ceasapro.com.br", senha: "demo123" };

async function entrar(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

test.describe("Convite de instalação do PWA", () => {
  // Sessão própria: o convite depende de um login de verdade (é o login que
  // sinaliza para a próxima tela) e de storage limpo.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("aparece uma vez depois do login e respeita o 'Agora não'", async ({ page }) => {
    await entrar(page);

    // O login pediu o convite; o AppShell abre na primeira tela.
    await expect(page.getByText(TITULO)).toBeVisible();

    // Chromium de desktop sem `beforeinstallprompt`: em vez de um botão que não
    // faria nada, o painel explica onde a instalação existe.
    await expect(page.getByText(/não oferece instalação/i)).toBeVisible();

    await page.getByRole("button", { name: "Agora não" }).click();
    await expect(page.getByText(TITULO)).toHaveCount(0);

    // Marcado como dispensado: não volta nas próximas telas...
    await page.goto("/produtos");
    await expect(page.getByText(TITULO)).toHaveCount(0);

    // ...nem num login novo dentro dos 7 dias. Precisa encerrar a sessão antes:
    // com sessão ativa o proxy manda /login direto para o dashboard.
    await page.request.post("/api/auth/logout", { data: {} });
    await entrar(page);
    await expect(page.getByText(TITULO)).toHaveCount(0);
  });

  test("Configurações reabre o convite mesmo depois de dispensado", async ({ page }) => {
    await entrar(page);
    await page.getByRole("button", { name: "Agora não" }).click();

    // Sem este caminho, quem dispensou ficaria sem forma de instalar.
    await page.goto("/configuracoes");
    await page.getByRole("button", { name: /Instalar app/i }).click();
    await expect(page.getByText(TITULO)).toBeVisible();
  });

  test("não aparece quando o app já está instalado", async ({ page }) => {
    // O componente decide por `display-mode: standalone`. O Playwright não emula
    // display-mode, então o teste substitui o matchMedia — é o mesmo sinal que o
    // navegador daria com o app aberto pela tela inicial.
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = ((q: string) =>
        q.includes("display-mode: standalone")
          ? {
              matches: true,
              media: q,
              onchange: null,
              addListener: () => {},
              removeListener: () => {},
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => false,
            }
          : original(q)) as typeof window.matchMedia;
    });

    await entrar(page);
    await expect(page.getByText(TITULO)).toHaveCount(0);

    // E o gatilho manual também desaparece: não há o que instalar.
    await page.goto("/configuracoes");
    await expect(page.getByRole("button", { name: /Instalar app/i })).toHaveCount(0);
  });
});

test.describe("Convite de instalação no iPhone", () => {
  // Safari do iPhone: sem `beforeinstallprompt`, o caminho é o passo a passo.
  test.use({
    storageState: { cookies: [], origins: [] },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  test("mostra o passo a passo do atalho em vez de botão de instalar", async ({ page }) => {
    await entrar(page);
    await expect(page.getByText(TITULO)).toBeVisible();

    // Não existe instalação nativa no iOS: oferecer "Instalar agora" seria
    // prometer o que o navegador não faz.
    await expect(page.getByRole("button", { name: "Instalar agora" })).toHaveCount(0);

    // Os passos aparecem DIRETO — no iOS não há nada a oferecer antes deles, e um
    // botão intermediário só somaria um toque.
    await expect(page.getByText("Adicionar à Tela de Início")).toBeVisible();
    await expect(page.getByText(/Compartilhar/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Entendi" })).toBeVisible();
  });
});
