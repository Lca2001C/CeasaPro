import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * O backfill da migration `estoque_unificado_compra_despesa`: toda compra
 * antiga ganha a despesa dela, PAGA na data da compra — e o frete que já tinha
 * sido lançado à parte não entra duas vezes.
 *
 * Executa o MESMO SQL do arquivo da migration (o trecho entre os marcadores
 * BACKFILL), restrito à empresa do teste para não tocar nas outras do banco.
 */

const MIGRATION = join(
  process.cwd(),
  "prisma/migrations/20261016120000_estoque_unificado_compra_despesa/migration.sql",
);

function sqlDoBackfill(tenantId: string): string[] {
  const texto = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
  const inicio = texto.indexOf("-- >>> BACKFILL");
  const fim = texto.indexOf("-- <<< BACKFILL");
  if (inicio < 0 || fim < 0) throw new Error("marcadores BACKFILL não encontrados na migration");
  const trecho = texto
    .slice(inicio, fim)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const t = `'${tenantId}'`;
  return trecho
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s
        // Escopo do teste: só a empresa criada aqui.
        .replace(`FROM "tenants" t\n`, `FROM "tenants" t WHERE t."id" = ${t}\n`)
        .replace(`AND e."origem" = 'MANUAL'`, `AND e."origem" = 'MANUAL' AND e."tenantId" = ${t}`)
        .replace(`WHERE p."deletedAt" IS NULL`, `WHERE p."deletedAt" IS NULL AND p."tenantId" = ${t}`),
    );
}

const tenants: string[] = [];
let tenantId = "";

beforeAll(async () => {
  tenantId = await createTestTenant("BACKFILL COMPRA");
  tenants.push(tenantId);
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

describe("backfill das compras antigas", () => {
  it("cria a despesa PAGA e desconta o frete que já tinha despesa própria", async () => {
    const supplier = await prisma.supplier.create({ data: { tenantId, name: "Fazenda Velha" } });
    const dia = new Date("2026-09-10T15:00:00Z");

    const semFrete = await prisma.purchase.create({
      data: { tenantId, supplierId: supplier.id, purchaseDate: dia, freight: 0, totalAmount: 300 },
    });
    const freteEmbutido = await prisma.purchase.create({
      data: { tenantId, purchaseDate: dia, freight: 40, totalAmount: 540 },
    });
    const freteLancado = await prisma.purchase.create({
      data: { tenantId, supplierId: supplier.id, purchaseDate: dia, freight: 60, totalAmount: 860 },
    });
    // Como a versão anterior gravava o "Lançar o frete como despesa".
    const frete = await prisma.expense.create({
      data: {
        tenantId,
        purchaseId: freteLancado.id,
        description: "Frete da compra — Fazenda Velha",
        amount: 60,
        type: "VARIAVEL",
        status: "PENDENTE",
        dueDate: dia,
      },
    });

    for (const sql of sqlDoBackfill(tenantId)) await prisma.$executeRawUnsafe(sql);
    // Rodar de novo não duplica.
    for (const sql of sqlDoBackfill(tenantId)) await prisma.$executeRawUnsafe(sql);

    const contas = await prisma.expense.findMany({ where: { tenantId, origem: "COMPRA" } });
    expect(contas).toHaveLength(3);
    const de = (id: string) => contas.find((c) => c.purchaseId === id)!;

    expect(Number(de(semFrete.id).amount)).toBe(300);
    expect(de(semFrete.id).status).toBe("PAGO");
    expect(de(semFrete.id).paidDate?.getTime()).toBe(dia.getTime());
    expect(de(semFrete.id).supplierId).toBe(supplier.id);
    expect(de(semFrete.id).description).toBe("Compra — Fazenda Velha");

    expect(Number(de(freteEmbutido.id).amount)).toBe(540);
    expect(de(freteEmbutido.id).description).toBe("Compra sem fornecedor (inclui frete R$ 40,00)");

    expect(Number(de(freteLancado.id).amount)).toBe(800);
    const freteDepois = await prisma.expense.findUniqueOrThrow({ where: { id: frete.id } });
    expect(freteDepois.origem).toBe("FRETE_COMPRA");
    expect(freteDepois.supplierId).toBe(supplier.id);

    const categoria = await prisma.expenseCategory.findFirst({
      where: { tenantId, name: "Compra de mercadoria" },
    });
    expect(categoria?.isDefault).toBe(true);
    expect(contas.every((c) => c.categoryId === categoria!.id)).toBe(true);
  });
});
