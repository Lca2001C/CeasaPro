import { test, expect } from "@playwright/test";

/**
 * Web Push (Fase 3 do PWA).
 *
 * O que NÃO dá para automatizar: a notificação chegando. Isso exige uma inscrição
 * real num serviço de push (FCM, Mozilla, Apple), que o Chromium headless não
 * obtém, e o aparelho recebendo com o app fechado — o cenário do recurso. Está no
 * checklist manual de `docs/10-pwa-evolucao.md`.
 *
 * O que dá — e é onde este recurso erra na prática:
 *
 * - a rota de inscrição sob sessão de verdade (as regras de dono estão em
 *   `tests/integration/push-inscricao.test.ts`; aqui é a borda HTTP: autenticação,
 *   validação e o ida-e-volta);
 * - a tela mostrar a saída certa para cada plataforma, em vez de oferecer um botão
 *   que não teria como funcionar.
 */

const DEMO = { email: "demo@ceasapro.com.br", senha: "demo123" };

/** Formato do FCM, num caminho que não existe. */
const endpointTeste = `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}`;
const inscricao = {
  endpoint: endpointTeste,
  keys: { p256dh: "BEl62iUYgUivxIkv69yViEuiBIa", auth: "8eDyX_uCN0XRhSbY5hs7Hg" },
};

async function entrar(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

test.describe("Rota de inscrição de push", () => {
  test("registra e remove a inscrição deste aparelho", async ({ request }) => {
    const criada = await request.post("/api/pwa/push", { data: inscricao });
    expect(criada.status()).toBe(200);

    // Reinscrever o mesmo aparelho é o caso comum (reabrir o opt-in) e não pode
    // virar uma segunda linha, senão cada aviso chega duplicado.
    const denovo = await request.post("/api/pwa/push", { data: inscricao });
    expect(denovo.status()).toBe(200);

    const removida = await request.delete("/api/pwa/push", {
      data: { endpoint: endpointTeste },
    });
    expect(removida.status()).toBe(200);
    // Uma só: a reinscrição atualizou a linha em vez de duplicar.
    expect(await removida.json()).toMatchObject({ data: { removidas: 1 } });
  });

  test("recusa endpoint que não é https", async ({ request }) => {
    // O cron faz requisição PARA este endereço. Aceitar http abriria caminho para
    // usar o servidor como cliente de um destino escolhido pelo cliente.
    const r = await request.post("/api/pwa/push", {
      data: { ...inscricao, endpoint: "http://127.0.0.1:8080/interno" },
    });
    // 422 é a convenção do projeto para entrada inválida (`ValidationError`).
    expect(r.status()).toBe(422);
  });

  test("recusa corpo sem as chaves de criptografia", async ({ request }) => {
    const r = await request.post("/api/pwa/push", { data: { endpoint: endpointTeste } });
    expect(r.status()).toBe(422);
  });

  test("exige sessão", async ({ playwright }) => {
    // `storageState` explícito: sem isto o contexto novo herda os cookies do
    // projeto `authed` e o teste passaria a medir o caminho autenticado.
    const anonimo = await playwright.request.newContext({
      baseURL: "http://localhost:3000",
      storageState: { cookies: [], origins: [] },
    });
    expect((await anonimo.post("/api/pwa/push", { data: inscricao })).status()).toBe(401);
    expect(
      (await anonimo.delete("/api/pwa/push", { data: { endpoint: endpointTeste } })).status(),
    ).toBe(401);
    await anonimo.dispose();
  });
});

test.describe("Opt-in de avisos em Configurações", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("com a permissão negada, explica o caminho em vez de insistir", async ({ page }) => {
    // O Chromium headless devolve `Notification.permission === "denied"` sempre —
    // conceder a permissão no contexto não muda isso. Então o estado exercitável
    // aqui é o da recusa, que é justamente o irreversível: negada uma vez, o site
    // NÃO pode pedir de novo, e a tela precisa dizer isso em vez de mostrar um
    // botão que não faria nada. O caminho de aceitação está no checklist manual.
    await entrar(page);
    await page.getByRole("button", { name: "Agora não" }).click();
    await page.goto("/configuracoes");

    await expect(page.getByText("Aplicativo e avisos")).toBeVisible();
    await expect(page.getByText(/bloqueados para o CeasaPro/i)).toBeVisible();
    await expect(page.getByText(/configurações do próprio navegador/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Ativar avisos/i })).toHaveCount(0);

    // O convite de instalação segue disponível: são dois pedidos separados, e a
    // recusa de um não pode levar o outro embora.
    await expect(page.getByRole("button", { name: /Instalar app/i })).toBeVisible();
  });
});

test.describe("Opt-in de avisos no iPhone", () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  test("numa aba do Safari, explica o pré-requisito em vez de oferecer o botão", async ({
    page,
  }) => {
    await entrar(page);
    await page.getByRole("button", { name: "Entendi" }).click();
    await page.goto("/configuracoes");

    // O pré-requisito do iOS vem ANTES da permissão: pedi-la numa aba falharia e
    // gastaria o único pedido que o navegador permite.
    await expect(page.getByText(/adicionado à tela de início/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Ativar avisos/i })).toHaveCount(0);
  });
});
