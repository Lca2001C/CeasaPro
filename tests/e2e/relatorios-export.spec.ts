import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

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

/**
 * Relatório de vendas por cliente: o extrato (todas as vendas dele, com os
 * itens) e o comprovante de cada venda, em PDF e Excel.
 */
test.describe("Vendas por cliente", () => {
  const prisma = new PrismaClient();
  const MARCA = `E2ECLI${Date.now()}`;
  const CLIENTE = `Cliente ${MARCA}`;
  let tenantId = "";
  let produtoId = "";
  let vendaId = "";

  test.beforeAll(async () => {
    const owner = await prisma.user.findFirstOrThrow({
      where: { email: "demo@ceasapro.com.br" },
      select: { tenantId: true },
    });
    tenantId = owner.tenantId!;
    produtoId = (
      await prisma.product.create({ data: { tenantId, name: `Produto ${MARCA}`, saleUnit: "CAIXA" } })
    ).id;
    vendaId = (
      await prisma.sale.create({
        data: {
          tenantId,
          customerName: CLIENTE,
          paymentMethod: "DINHEIRO",
          subtotalAmount: 60,
          totalAmount: 60,
          items: {
            create: [{ tenantId, productId: produtoId, quantity: 2, unitPrice: 30, lineTotal: 60 }],
          },
        },
      })
    ).id;
  });

  test.afterAll(async () => {
    await prisma.saleItem.deleteMany({ where: { saleId: vendaId } });
    await prisma.sale.deleteMany({ where: { id: vendaId } });
    await prisma.product.deleteMany({ where: { id: produtoId } });
    await prisma.$disconnect();
  });

  test("todas as vendas do cliente saem em PDF e Excel", async ({ page }) => {
    const base = `/api/reports/vendas/export?preset=tudo&cliente=${encodeURIComponent(CLIENTE)}`;
    const pdf = await page.request.get(`${base}&format=pdf`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe(ASSINATURA_PDF);
    // O nome do arquivo leva o cliente, sem acento nem espaço.
    expect(pdf.headers()["content-disposition"]).toContain(`vendas-cliente-${MARCA.toLowerCase()}`);

    const excel = await page.request.get(`${base}&format=excel`);
    expect(excel.status()).toBe(200);
    expect((await excel.body()).subarray(0, 2).toString("latin1")).toBe(ASSINATURA_XLSX);
  });

  test("o comprovante de uma venda sai em PDF e Excel", async ({ page }) => {
    const pdf = await page.request.get(`/api/vendas/${vendaId}/comprovante?format=pdf`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe(ASSINATURA_PDF);

    const excel = await page.request.get(`/api/vendas/${vendaId}/comprovante?format=excel`);
    expect(excel.status()).toBe(200);
    expect((await excel.body()).subarray(0, 2).toString("latin1")).toBe(ASSINATURA_XLSX);
  });

  test("comprovante de venda que não existe é 404, e sem sessão é 401", async ({
    page,
    browser,
  }) => {
    const res = await page.request.get("/api/vendas/nao-existe/comprovante?format=pdf");
    expect(res.status()).toBe(404);

    const anonimo = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const semSessao = await anonimo.request.get(`/api/vendas/${vendaId}/comprovante?format=pdf`);
    expect(semSessao.status()).toBe(401);
    await anonimo.close();
  });

  test("na tela, escolher o cliente mostra o extrato e o comprovante de cada venda", async ({
    page,
  }) => {
    await page.goto("/relatorios/vendas");
    await page.getByLabel("Cliente", { exact: true }).selectOption({ label: CLIENTE });
    await expect(page).toHaveURL(/cliente=/);
    await expect(page.getByRole("heading", { name: `Vendas de ${CLIENTE}` })).toBeVisible();
    await expect(page.getByRole("cell", { name: `Produto ${MARCA}` })).toBeVisible();
    await expect(page.getByRole("link", { name: /^PDF — comprovante da venda/ })).toBeVisible();
    // Com cliente, o período oferece o histórico inteiro.
    await page.getByLabel("Período").selectOption("tudo");
    await expect(page).toHaveURL(/preset=tudo/);
  });

  test("a ficha do cliente oferece todas as vendas e o comprovante de cada uma", async ({
    page,
  }) => {
    await page.goto(`/vendas/clientes/${encodeURIComponent(CLIENTE.toLowerCase())}`);
    const todas = page.getByRole("link", { name: `PDF — todas as vendas de ${CLIENTE}` });
    await expect(todas).toBeVisible();
    await expect(todas).toHaveAttribute("href", /preset=tudo/);
    await expect(page.getByRole("link", { name: /^Excel — comprovante da venda/ })).toBeVisible();
  });
});
