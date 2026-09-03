import { test, expect } from "@playwright/test";

/**
 * Download de relatório — Excel e PDF, pela rota de verdade.
 *
 * Nenhum teste exercitava a exportação, e ela é o caminho em que mais coisa
 * pode dar errado sem ninguém ver: o PDF resolve fontes de dentro de
 * `node_modules` numa configuração preguiçosa, e o Excel depende de uma
 * biblioteca cujo `npm audit fix --force` propõe substituir por uma versão de
 * API incompatível. Falha ali é 500 na cara do cliente, no meio do fechamento.
 *
 * Roda contra o BUILD de produção (ver `webServer` em playwright.config.ts) —
 * é o único jeito de saber que o caminho real funciona, e não só o do vitest,
 * onde o interop de módulo é diferente.
 */

/** Assinaturas de arquivo: xlsx é um zip ("PK"), pdf começa com "%PDF-". */
const ASSINATURA_XLSX = "PK";
const ASSINATURA_PDF = "%PDF-";

test.describe("Exportação de relatórios", () => {
  test("Excel baixa um arquivo válido", async ({ page }) => {
    const res = await page.request.get(
      "/api/reports/vendas/export?preset=mes&format=excel",
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml");
    expect(res.headers()["content-disposition"]).toContain("attachment");

    const corpo = await res.body();
    expect(corpo.subarray(0, 2).toString("latin1")).toBe(ASSINATURA_XLSX);
    expect(corpo.byteLength).toBeGreaterThan(2000);
  });

  test("PDF baixa um arquivo válido — inclusive na segunda vez", async ({ page }) => {
    // A segunda chamada é a que importa: a configuração de fonte do pdfmake é
    // preguiçosa e guardada no módulo. Numa instância serverless já aquecida, o
    // primeiro download acontece e o segundo é que quebraria — sintoma que só
    // aparece em produção, nunca no primeiro teste manual.
    for (const tentativa of [1, 2]) {
      const res = await page.request.get(
        "/api/reports/vendas/export?preset=mes&format=pdf",
      );
      expect(res.status(), `tentativa ${tentativa}`).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/pdf");

      const corpo = await res.body();
      expect(corpo.subarray(0, 5).toString("latin1"), `tentativa ${tentativa}`).toBe(
        ASSINATURA_PDF,
      );
      expect(corpo.byteLength).toBeGreaterThan(1000);
    }
  });

  test("período sem movimento ainda devolve arquivo, não erro", async ({ page }) => {
    // Exportar um mês vazio é comum (começo de mês, empresa nova) e não pode
    // virar 500 nem página em branco.
    const res = await page.request.get(
      "/api/reports/vendas/export?preset=personalizado&from=2020-01-01&to=2020-01-31&format=pdf",
    );
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 5).toString("latin1")).toBe(ASSINATURA_PDF);
  });

  test("tipo de relatório inexistente é recusado", async ({ page }) => {
    const res = await page.request.get("/api/reports/inventado/export?format=pdf");
    expect(res.status()).toBe(404);
  });

  test("exportação exige sessão", async ({ browser }) => {
    // Contexto sem cookies: a rota não pode entregar dado de empresa nenhuma.
    const anonimo = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await anonimo.request.get(
      "/api/reports/vendas/export?preset=mes&format=excel",
    );
    expect(res.status()).toBe(401);
    await anonimo.close();
  });
});
