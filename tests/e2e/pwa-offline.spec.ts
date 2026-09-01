import { test, expect } from "@playwright/test";

/**
 * Consulta offline (Fase 2 do PWA).
 *
 * O que se prova aqui, e não dá para verificar olhando: que o snapshot é gravado
 * ao abrir o Início, que a tela offline mostra os dados COM a hora de origem, e que
 * sair apaga os dados do aparelho. A recusa de escrita offline fica no unitário
 * `api-client-offline.test.ts`, onde dá para afirmar que o fetch nem é chamado.
 *
 * O que fica fora: o comportamento do service worker. Ele só é registrado com
 * `NODE_ENV=production` (`pwa-register.tsx`) e exige HTTPS — o `npm start` do
 * Playwright serve HTTP em localhost, então o SW não assume o controle e a escolha
 * entre /consulta-offline e /offline não é exercitada. Está no checklist manual.
 */

const DEMO = { email: "demo@ceasapro.com.br", senha: "demo123" };

async function entrar(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  // O convite de instalação é modal e cobriria o resto da tela.
  await page.getByRole("button", { name: "Agora não" }).click();
}

/** O snapshot chega ao IndexedDB de forma assíncrona; espera até aparecer. */
async function esperarSnapshot(page: import("@playwright/test").Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const req = indexedDB.open("ceasapro-offline");
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("snapshot")) return resolve(false);
                const get = db.transaction("snapshot", "readonly").objectStore("snapshot").get("atual");
                get.onsuccess = () => resolve(Boolean(get.result));
                get.onerror = () => resolve(false);
              };
              req.onerror = () => resolve(false);
            }),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.describe("Consulta offline", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("guarda o snapshot no Início e mostra os dados com a hora de origem", async ({ page }) => {
    await entrar(page);
    await esperarSnapshot(page);

    await page.goto("/consulta-offline");

    // A regra da tela: número sempre acompanhado da hora em que foi buscado.
    await expect(page.getByText(/^Dados de \d{2}\/\d{2}/)).toBeVisible();
    await expect(page.getByText("Vendi hoje")).toBeVisible();
    await expect(page.getByText("Quem me deve")).toBeVisible();
    await expect(page.getByText("O que tenho em estoque")).toBeVisible();

    // Online, a tela diz que existe dado mais novo em vez de se passar pelo atual.
    await expect(page.getByRole("link", { name: "Ver dados atualizados" })).toBeVisible();
  });

  test("sem rede: avisa e leva para os dados salvos", async ({ page, context }) => {
    await entrar(page);
    await esperarSnapshot(page);

    await context.setOffline(true);

    // A faixa aparece antes de o usuário tentar qualquer coisa — sem ela, ele só
    // descobriria o problema depois de digitar a venda inteira.
    await expect(page.getByText(/Sem conexão/)).toBeVisible();
    await expect(page.getByRole("link", { name: /consultar os dados salvos/i })).toBeVisible();

    // A faixa aponta para /consulta-offline, mas NAVEGAR até lá sem rede depende do
    // service worker servindo a página do precache — e ele não está ativo aqui
    // (só registra em produção, sobre HTTPS). Sem SW o navegador mostra a própria
    // tela de erro, então este ambiente não consegue provar a navegação offline.
    // O conteúdo da tela já é verificado no primeiro teste, e o caminho offline
    // completo está no checklist manual de `docs/10-pwa-evolucao.md`.
    const destino = await page
      .getByRole("link", { name: /consultar os dados salvos/i })
      .getAttribute("href");
    expect(destino).toBe("/consulta-offline");

    await context.setOffline(false);
    await page.goto("/consulta-offline");
    await expect(page.getByText(/^Dados de \d{2}\/\d{2}/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver dados atualizados" })).toBeVisible();
    await expect(page.getByText(/somente consulta/i)).toBeVisible();

    // A recusa de ESCRITA offline é do `api-client` e está coberta em
    // `tests/unit/api-client-offline.test.ts`: lá dá para afirmar que o fetch nem
    // é chamado, o que aqui seria indistinguível de uma falha de rede qualquer.
  });

  test("sair apaga o snapshot do aparelho", async ({ page }) => {
    await entrar(page);
    await esperarSnapshot(page);

    // Requisito de privacidade: num celular compartilhado, a tela de consulta lê
    // do IndexedDB SEM pedir sessão, então o dado não pode sobreviver ao logout.
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login/);

    const aindaTem = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const req = indexedDB.open("ceasapro-offline");
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("snapshot")) return resolve(false);
            const get = db.transaction("snapshot", "readonly").objectStore("snapshot").get("atual");
            get.onsuccess = () => resolve(Boolean(get.result));
            get.onerror = () => resolve(false);
          };
          req.onerror = () => resolve(false);
        }),
    );
    expect(aindaTem).toBe(false);

    // E a tela de consulta trata "sem dados" como estado normal, não como erro.
    await page.goto("/consulta-offline");
    await expect(page.getByText("Nenhum dado salvo neste aparelho")).toBeVisible();
  });
});
