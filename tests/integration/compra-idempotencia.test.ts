import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { EstoqueService } from "@/lib/services/estoque.service";
import { ComprasService } from "@/lib/services/compras.service";
import { isoDateTz } from "@/lib/tz";
import type { CompraInput } from "@/lib/validations/compra";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Compra enviada duas vezes (toque duplo em "Salvar compra", ou retentativa
 * depois de um timeout em que o servidor já tinha gravado).
 *
 * Antes, cada envio dava entrada no estoque e lançava a conta de novo. Com a
 * chave de idempotência, o segundo devolve a primeira compra.
 */

const tenants: string[] = [];
let tenantId = "";
let productId = "";
let ctx = makeCtx("");

beforeAll(async () => {
  tenantId = await createTestTenant("COMPRA IDEMP");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  const p = await getTenantPrisma(tenantId).product.create({
    data: { tenantId, name: "Batata", saleUnit: "CAIXA" },
  });
  productId = p.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

function compra(chave?: string): CompraInput {
  return {
    supplierId: null,
    purchaseDate: isoDateTz(),
    freight: 20,
    items: [{ productId, quantity: 10, unitPrice: 5 }],
    ...(chave ? { idempotencyKey: chave } : {}),
  };
}

async function saldo(): Promise<number> {
  return (await EstoqueService.getQuantidades(tenantId))[productId] ?? 0;
}

const registrar = (input: CompraInput) => ComprasService.registrarCompra(input, ctx);

describe("compra com chave de idempotência", () => {
  it("reenvio depois da primeira devolve a MESMA compra, sem nova entrada nem conta", async () => {
    const chave = randomUUID();
    const antes = await saldo();
    const a = await registrar(compra(chave));
    const b = await registrar(compra(chave));

    expect(b.id).toBe(a.id);
    expect(await saldo()).toBe(antes + 10);
    const contas = await prisma.expense.findMany({ where: { tenantId, purchaseId: a.id } });
    expect(contas).toHaveLength(1);
    expect(contas[0].origem).toBe("COMPRA");
    expect(Number(contas[0].amount)).toBe(70);
  });

  it("dois envios SIMULTÂNEOS com a mesma chave gravam uma compra só", async () => {
    const chave = randomUUID();
    const antes = await saldo();
    const [a, b] = await Promise.all([
      registrar(compra(chave)),
      registrar(compra(chave)),
    ]);

    expect(b.id).toBe(a.id);
    expect(await saldo()).toBe(antes + 10);
    const compras = await prisma.purchase.count({ where: { tenantId, idempotencyKey: chave } });
    expect(compras).toBe(1);
    expect(await prisma.expense.count({ where: { tenantId, purchaseId: a.id } })).toBe(1);
  });

  it("sem chave (cliente antigo) continua gravando cada envio", async () => {
    const antes = await saldo();
    await registrar(compra());
    await registrar(compra());
    expect(await saldo()).toBe(antes + 20);
  });
});
