import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { ComprasService } from "@/lib/services/compras.service";
import { VendasService } from "@/lib/services/vendas.service";
import { FiadoService } from "@/lib/services/fiado.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

let tenantId = "";
let productId = "";
let ctx = makeCtx("");

beforeAll(async () => {
  tenantId = await createTestTenant("FLUXO");
  ctx = makeCtx(tenantId);
  const p = await getTenantPrisma(tenantId).product.create({
    data: { tenantId, name: "Tomate", saleUnit: "CAIXA" },
  });
  productId = p.id;
});

afterAll(async () => {
  await cleanupTenants([tenantId]);
});

describe("Fluxo compra → estoque → venda → fiado", () => {
  it("compra entra no estoque e soma o frete no valor", async () => {
    await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: new Date().toISOString().slice(0, 10),
        freight: 5,
        items: [{ productId, quantity: 10, unitPrice: 2 }],
      },
      ctx,
    );
    const qty = await EstoqueService.getQuantity(tenantId, productId);
    expect(qty.toString()).toBe("10");
    const value = await EstoqueService.getTotalValue(tenantId);
    // 10 * custoUnitário(2 + frete 5/10=0.5) = 10 * 2.5 = 25
    expect(value.toString()).toBe("25");
  });

  it("venda fiada baixa o estoque e cria conta a receber", async () => {
    await VendasService.registrarVenda(
      {
        customerName: "Cliente X",
        paymentMethod: "FIADO",
        items: [{ productId, quantity: 4, unitPrice: 5 }],
      },
      ctx,
    );
    const qty = await EstoqueService.getQuantity(tenantId, productId);
    expect(qty.toString()).toBe("6");

    const { contas, totalGeral } = await FiadoService.listOpen(tenantId);
    expect(contas).toHaveLength(1);
    expect(totalGeral.toString()).toBe("20"); // 4 * 5
  });

  it("bloqueia venda acima do estoque disponível", async () => {
    await expect(
      VendasService.registrarVenda(
        {
          customerName: null,
          paymentMethod: "DINHEIRO",
          items: [{ productId, quantity: 999, unitPrice: 5 }],
        },
        ctx,
      ),
    ).rejects.toThrow(/insuficiente/i);
  });

  it("pagamento parcial reduz o saldo e não quita; pagamento final quita", async () => {
    const { contas } = await FiadoService.listOpen(tenantId);
    const accountId = contas[0]!.id;

    const afterPartial = await FiadoService.registrarPagamento(
      { accountId, amount: 8, method: "DINHEIRO" },
      ctx,
    );
    expect(afterPartial.status).toBe("EM_ABERTO");
    expect(afterPartial.paidAmount.toString()).toBe("8");

    const afterFinal = await FiadoService.registrarPagamento(
      { accountId, amount: 12, method: "PIX" },
      ctx,
    );
    expect(afterFinal.status).toBe("PAGO");
  });

  it("não permite pagar mais que o saldo devedor", async () => {
    // cria nova venda fiada de 10 e tenta pagar 50
    await VendasService.registrarVenda(
      {
        customerName: "Cliente Y",
        paymentMethod: "FIADO",
        items: [{ productId, quantity: 2, unitPrice: 5 }],
      },
      ctx,
    );
    const { contas } = await FiadoService.listOpen(tenantId);
    const conta = contas.find((c) => c.customerName === "Cliente Y")!;
    await expect(
      FiadoService.registrarPagamento({ accountId: conta.id, amount: 50, method: "DINHEIRO" }, ctx),
    ).rejects.toThrow(/saldo/i);
  });
});
