import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { EstoqueService } from "@/lib/services/estoque.service";
import { registrarCompraComFrete } from "@/lib/services/compras.service";
import { isoDateTz } from "@/lib/tz";
import type { CompraInput } from "@/lib/validations/compra";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Compra enviada duas vezes (toque duplo em "Salvar compra", ou retentativa
 * depois de um timeout em que o servidor já tinha gravado).
 *
 * Antes, cada envio dava entrada no estoque e lançava o frete de novo. Com a
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
    lancarFreteComoDespesa: true,
    items: [{ productId, quantity: 10, unitPrice: 5 }],
    ...(chave ? { idempotencyKey: chave } : {}),
  };
}

async function saldo(): Promise<number> {
  return (await EstoqueService.getQuantidades(tenantId))[productId] ?? 0;
}

describe("compra com chave de idempotência", () => {
  it("reenvio depois da primeira devolve a MESMA compra, sem nova entrada nem frete", async () => {
    const chave = randomUUID();
    const antes = await saldo();
    const a = await registrarCompraComFrete(compra(chave), ctx);
    const b = await registrarCompraComFrete(compra(chave), ctx);

    expect(b.id).toBe(a.id);
    expect(await saldo()).toBe(antes + 10);
    const fretes = await prisma.expense.count({ where: { tenantId, purchaseId: a.id } });
    expect(fretes).toBe(1);
  });

  it("dois envios SIMULTÂNEOS com a mesma chave gravam uma compra só", async () => {
    const chave = randomUUID();
    const antes = await saldo();
    const [a, b] = await Promise.all([
      registrarCompraComFrete(compra(chave), ctx),
      registrarCompraComFrete(compra(chave), ctx),
    ]);

    expect(b.id).toBe(a.id);
    expect(await saldo()).toBe(antes + 10);
    const compras = await prisma.purchase.count({ where: { tenantId, idempotencyKey: chave } });
    expect(compras).toBe(1);
  });

  it("sem chave (cliente antigo) continua gravando cada envio", async () => {
    const antes = await saldo();
    await registrarCompraComFrete(compra(), ctx);
    await registrarCompraComFrete(compra(), ctx);
    expect(await saldo()).toBe(antes + 20);
  });
});
