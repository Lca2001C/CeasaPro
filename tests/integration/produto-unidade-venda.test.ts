import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { ProdutosService } from "@/lib/services/produtos.service";
import { ComprasService } from "@/lib/services/compras.service";
import { BusinessRuleError } from "@/lib/http/app-error";
import { isoDateTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Unidade de venda de produto com histórico.
 *
 * Nenhum movimento, compra ou venda guarda a unidade — todos leem a do produto
 * vivo. Trocar CAIXA → KG num produto com 50 caixas em estoque fazia a tela
 * mostrar "50 kg", o custo por caixa virar custo por quilo e o fiado passado
 * ser relido em quilos. A troca é recusada; sem histórico, continua livre.
 */
const tenants: string[] = [];
let tenantId = "";
let ctx = makeCtx("");

beforeAll(async () => {
  tenantId = await createTestTenant("UNIDADE VENDA");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

async function produto(nome: string) {
  return getTenantPrisma(tenantId).product.create({
    data: { tenantId, name: nome, saleUnit: "CAIXA" },
  });
}

const edicao = (id: string, saleUnit: "CAIXA" | "KG", name = "Tomate") => ({
  id,
  name,
  saleUnit,
  active: true,
});

describe("troca de unidade de venda", () => {
  it("é recusada quando o produto já tem compra/estoque", async () => {
    const p = await produto("Tomate");
    await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: isoDateTz(),
        freight: 0,
        items: [{ productId: p.id, quantity: 50, unitPrice: 80 }],
      },
      ctx,
    );

    await expect(ProdutosService.update(edicao(p.id, "KG"), ctx)).rejects.toThrow(
      BusinessRuleError,
    );
    const depois = await getTenantPrisma(tenantId).product.findFirstOrThrow({
      where: { id: p.id },
    });
    expect(depois.saleUnit).toBe("CAIXA");

    // Editar o resto, mantendo a unidade, continua permitido.
    const renomeado = await ProdutosService.update(edicao(p.id, "CAIXA", "Tomate italiano"), ctx);
    expect(renomeado.name).toBe("Tomate italiano");
  });

  it("é livre enquanto o produto não tem nenhum lançamento", async () => {
    const p = await produto("Chuchu");
    const r = await ProdutosService.update(edicao(p.id, "KG", "Chuchu"), ctx);
    expect(r.saleUnit).toBe("KG");
  });
});
