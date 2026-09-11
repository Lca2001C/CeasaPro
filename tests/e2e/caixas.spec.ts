import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Caixas plásticas — patrimônio que circula fora do box.
 *
 * O saldo é um livro-razão (não há coluna de saldo): limpas, sujas, com
 * clientes, perdidas. Quem erra aqui descobre semanas depois, na conferência
 * física, sem saber de onde veio a diferença.
 *
 * Os saldos são medidos por DELTA, e não por valor absoluto: a empresa demo é
 * compartilhada e já tem caixas de outros testes. O que importa provar é que
 * cada movimento mexe na coluna certa, na direção certa.
 */

const prisma = new PrismaClient();

const MARCA = `E2EK${Date.now()}`;
const CLIENTE = `Cliente ${MARCA}`;
const ENTRADA = 10;
const SAIDA = 4;

let tenantId = "";

/** Lê o número de um cartão de saldo pelo rótulo visível. */
async function saldo(page: import("@playwright/test").Page, rotulo: string): Promise<number> {
  const cartao = page.locator('main [data-slot="card"]').filter({ hasText: rotulo }).first();
  const texto = (await cartao.innerText()).replace(rotulo, "");
  const n = texto.match(/-?\d+/);
  return n ? Number(n[0]) : 0;
}

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({
    where: { email: "demo@ceasapro.com.br" },
    select: { tenantId: true },
  });
  tenantId = owner.tenantId!;
});

test.afterAll(async () => {
  // Tudo deste arquivo foi marcado nas observações ou no nome do cliente.
  await prisma.plasticCrateMovement.deleteMany({
    where: {
      tenantId,
      OR: [{ notes: { contains: MARCA } }, { customerName: { contains: MARCA } }],
    },
  });
  await prisma.$disconnect();
});

/** Registra um movimento pela tela. */
async function movimentar(
  page: import("@playwright/test").Page,
  opts: { tipo: string; quantidade: number; cliente?: string },
) {
  await page.goto("/caixas-plasticas/novo");
  await page.getByLabel("Tipo de movimentação").selectOption(opts.tipo);
  await page.getByLabel("Quantidade de caixas").fill(String(opts.quantidade));
  if (opts.cliente) await page.getByLabel("Cliente", { exact: true }).fill(opts.cliente);
  await page.getByLabel("Observações").fill(MARCA);
  await page.getByRole("button", { name: "Registrar" }).click();
}

test.describe("Caixas plásticas", () => {
  test("entrada, saída para cliente e retorno movem os saldos certos", async ({ page }) => {
    await page.goto("/caixas-plasticas");
    const limpasAntes = await saldo(page, "Limpas (prontas)");
    const clientesAntes = await saldo(page, "Com clientes");

    // 1. Entrada: caixas limpas chegam ao box.
    await movimentar(page, { tipo: "ENTRADA", quantidade: ENTRADA });
    await page.waitForURL(/\/caixas-plasticas$/, { timeout: 15_000 });
    expect(await saldo(page, "Limpas (prontas)")).toBe(limpasAntes + ENTRADA);

    // 2. Saída com o cliente: sai das limpas e passa a estar COM ELE. É o número
    //    que o box cobra de volta.
    await movimentar(page, { tipo: "SAIDA", quantidade: SAIDA, cliente: CLIENTE });
    await page.waitForURL(/\/caixas-plasticas$/, { timeout: 15_000 });
    expect(await saldo(page, "Limpas (prontas)")).toBe(limpasAntes + ENTRADA - SAIDA);
    expect(await saldo(page, "Com clientes")).toBe(clientesAntes + SAIDA);

    // 3. Retorno: o cliente devolve. Sai de "com clientes" e volta ao estoque.
    await movimentar(page, { tipo: "RETORNO", quantidade: SAIDA, cliente: CLIENTE });
    await page.waitForURL(/\/caixas-plasticas$/, { timeout: 15_000 });
    expect(await saldo(page, "Com clientes")).toBe(clientesAntes);
  });

  test("recusa entregar mais caixas do que existe limpas", async ({ page }) => {
    /*
      Sem esta barreira o saldo "com clientes" cresceria além do que o box tem,
      e a cobrança de vasilhame passaria a acusar caixas que nunca saíram.
    */
    await page.goto("/caixas-plasticas");
    const limpas = await saldo(page, "Limpas (prontas)");

    await movimentar(page, {
      tipo: "SAIDA",
      quantidade: limpas + 500,
      cliente: CLIENTE,
    });

    // A mensagem diz quantas existem, para o operador corrigir sem sair da tela.
    await expect(page.getByText(/caixa\(s\) limpa\(s\)/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/caixas-plasticas\/novo/);
  });
});
