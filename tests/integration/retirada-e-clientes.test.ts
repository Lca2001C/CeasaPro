import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { VendasService } from "@/lib/services/vendas.service";
import { ClientesService, chaveDoCliente } from "@/lib/services/clientes.service";
import { AvisosService } from "@/lib/services/avisos.service";
import { vendaPdvSchema } from "@/lib/validations/venda";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Retirada da venda ("Busca depois" no PDV → checkbox "Buscado") e a aba
 * Clientes, que agrupa as vendas pelo nome do cliente.
 */

const tenants: string[] = [];
let tenantId = "";
let outroTenant = "";
let ctx = makeCtx("");
let productId = "";

beforeAll(async () => {
  tenantId = await createTestTenant("RETIRADA CLIENTES");
  outroTenant = await createTestTenant("RETIRADA OUTRO");
  tenants.push(tenantId, outroTenant);
  ctx = makeCtx(tenantId);
  const db = getTenantPrisma(tenantId);
  productId = (await db.product.create({ data: { tenantId, name: "Tomate", saleUnit: "CAIXA" } }))
    .id;
  await prisma.stockMovement.create({
    data: { tenantId, productId, type: "ENTRADA", quantity: 100, unitCost: 10 },
  });
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

function venda(customerName: string | null, retirarDepois: boolean | undefined) {
  return {
    customerName,
    paymentMethod: "DINHEIRO" as const,
    retirarDepois,
    items: [{ productId, quantity: 2, unitPrice: 30 }],
  };
}

describe("Escolha de retirada no PDV", () => {
  it("é obrigatória, e quem busca depois precisa de nome", () => {
    expect(vendaPdvSchema.safeParse(venda("Ana", undefined)).success).toBe(false);
    expect(vendaPdvSchema.safeParse(venda(null, true)).success).toBe(false);
    expect(vendaPdvSchema.safeParse(venda(null, false)).success).toBe(true);
    expect(vendaPdvSchema.safeParse(venda("Ana", true)).success).toBe(true);
  });
});

describe("Retirada", () => {
  it("leva agora nasce retirada; busca depois aguarda até o checkbox", async () => {
    const agora = await VendasService.registrarVenda(venda("Ana", false), ctx);
    expect(agora.retirarDepois).toBe(false);
    expect(agora.retiradoEm).not.toBeNull();

    const depois = await VendasService.registrarVenda(venda("João", true), ctx);
    expect(depois.retiradoEm).toBeNull();

    const pendentes = await VendasService.aguardandoRetirada(tenantId);
    expect(pendentes.map((v) => v.id)).toEqual([depois.id]);

    const avisos = await AvisosService.get(tenantId, []);
    expect(avisos.find((a) => a.tipo === "retirada_pendente")?.href).toBe(`/vendas/${depois.id}`);

    await VendasService.marcarRetirada({ id: depois.id, retirado: true }, ctx);
    expect(await VendasService.aguardandoRetirada(tenantId)).toHaveLength(0);
    expect((await AvisosService.get(tenantId, [])).some((a) => a.tipo === "retirada_pendente")).toBe(
      false,
    );

    // Desmarcar (toque errado) volta para aguardando.
    await VendasService.marcarRetirada({ id: depois.id, retirado: false }, ctx);
    expect(await VendasService.aguardandoRetirada(tenantId)).toHaveLength(1);

    // Venda levada na hora não tem retirada para marcar.
    await expect(
      VendasService.marcarRetirada({ id: agora.id, retirado: false }, ctx),
    ).rejects.toThrow(/levada na hora/);

    // Outra empresa não alcança a venda.
    await expect(
      VendasService.marcarRetirada({ id: depois.id, retirado: true }, makeCtx(outroTenant)),
    ).rejects.toThrow(/não encontrada/);
  });
});

describe("Clientes", () => {
  it("agrupa pelo nome sem caixa nem espaços e lista as compras", async () => {
    await VendasService.registrarVenda(venda("  maria ", false), ctx);
    await VendasService.registrarVenda(venda("Maria", true), ctx);

    const lista = await ClientesService.list(tenantId);
    const maria = lista.find((c) => c.chave === chaveDoCliente("Maria"))!;
    expect(maria.compras).toBe(2);
    expect(Number(maria.totalComprado)).toBe(120);
    expect(maria.aguardandoRetirada).toBe(1);
    expect(maria.nome).toBe("Maria");

    const ficha = await ClientesService.detalhe(tenantId, "maria");
    expect(ficha?.vendas).toHaveLength(2);
    expect(ficha?.vendas[0]?.items[0]?.product.name).toBe("Tomate");

    expect(await ClientesService.detalhe(outroTenant, "maria")).toBeNull();
    expect((await ClientesService.list(outroTenant)).length).toBe(0);
  });
});
