import { test, expect } from "@playwright/test";

/**
 * Consulta offline (Fase 2 do PWA).
 *
 * O que se prova aqui, e não dá para verificar olhando: que o snapshot é gravado
 * ao abrir o Início, que a tela offline mostra os dados COM a hora de origem, e que
 * sair apaga os dados do aparelho. A recusa de escrita offline fica no unitário
 * `api-client-offline.test.ts`, onde dá para afirmar que o fetch nem é chamado.
 *
 * O service worker ENTRA no teste: `http://localhost` é contexto seguro, então o
 * build de produção que o Playwright sobe registra o SW e ele assume o controle da
 * página. Isso permite exercitar a escolha do fallback — /consulta-offline quando há
 * dados no aparelho, /offline quando não há — que é a lógica central desta fase.
 * O que fica de fora é a instalação nativa, no checklist manual de
 * `docs/10-pwa-evolucao.md`.
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

/** Lê o IndexedDB do aparelho: existe snapshot guardado? */
function temSnapshot(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(
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
}

/** O snapshot chega ao IndexedDB de forma assíncrona; espera até aparecer. */
async function esperarSnapshot(page: import("@playwright/test").Page) {
  await expect.poll(() => temSnapshot(page), { timeout: 15_000 }).toBe(true);
}

/**
 * Espera o SW assumir o controle da página.
 *
 * Registrado não basta: até o `clients.claim()` a página aberta segue sem
 * controlador, e sem controlador ninguém intercepta a navegação offline.
 */
async function esperarServiceWorker(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  });
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
    await esperarServiceWorker(page);

    await context.setOffline(true);

    // A faixa aparece antes de o usuário tentar qualquer coisa — sem ela, ele só
    // descobriria o problema depois de digitar a venda inteira.
    await expect(page.getByText(/Sem conexão/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /consultar os dados salvos/i }),
    ).toHaveAttribute("href", "/consulta-offline");

    // E navegar sem rede tem de FUNCIONAR: quem responde é o service worker, com a
    // página do precache. Vale para QUALQUER rota, não só o link da faixa — abrir o
    // app pelo ícone da tela inicial cai exatamente aqui.
    await page.goto("/produtos");
    await expect(page.getByText(/^Dados de \d{2}\/\d{2}/)).toBeVisible();
    await expect(page.getByText(/somente consulta/i)).toBeVisible();

    // A recusa de ESCRITA offline é do `api-client` e está coberta em
    // `tests/unit/api-client-offline.test.ts`: lá dá para afirmar que o fetch nem
    // é chamado, o que aqui seria indistinguível de uma falha de rede qualquer.
  });

  test("sem rede e sem dados salvos: cai na tela de sem conexão, não na de consulta", async ({
    page,
    context,
  }) => {
    await entrar(page);
    await esperarSnapshot(page);
    await esperarServiceWorker(page);

    // Aparelho que nunca sincronizou. Abrir a tela de consulta vazia seria pior que
    // dizer "sem conexão": ela prometeria dados que não existem.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase("ceasapro-offline");
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        }),
    );

    await context.setOffline(true);
    await page.goto("/produtos");

    // Texto da propria pagina /offline, nao da faixa de rede: e ele que prova
    // qual dos dois destinos o service worker escolheu.
    await expect(page.getByText("Você está offline")).toBeVisible();
    await expect(page.getByText(/^Dados de \d{2}\/\d{2}/)).toHaveCount(0);
  });

  test("sair apaga o snapshot do aparelho", async ({ page }) => {
    await entrar(page);
    await esperarSnapshot(page);

    // Requisito de privacidade: num celular compartilhado, a tela de consulta lê
    // do IndexedDB SEM pedir sessão, então o dado não pode sobreviver ao logout.
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login/);

    expect(await temSnapshot(page)).toBe(false);

    // E a tela de consulta trata "sem dados" como estado normal, não como erro.
    await page.goto("/consulta-offline");
    await expect(page.getByText("Nenhum dado salvo neste aparelho")).toBeVisible();
  });
});
