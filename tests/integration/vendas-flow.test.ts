import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { ComprasService } from "@/lib/services/compras.service";
import { VendasService } from "@/lib/services/vendas.service";
import { FiadoService } from "@/lib/services/fiado.service";
import { CaixasService } from "@/lib/services/caixas.service";
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

describe("Fiado com itens, data da venda e caixas plásticas", () => {
  const hoje = new Date().toISOString().slice(0, 10);

  it("bloqueia o lançamento quando não há caixas limpas em estoque", async () => {
    await expect(
      FiadoService.create(
        {
          customerName: "Cliente Caixas",
          saleDate: hoje,
          plasticCrateQty: 5,
          items: [{ productId, quantity: 1, unitPrice: 10 }],
        },
        ctx,
      ),
    ).rejects.toThrow(/limpa/i);
  });

  it("lança fiado manual com itens e caixas, e move o ledger de caixas", async () => {
    await CaixasService.registrar(
      { type: "ENTRADA", quantity: 20, supplierName: "Ceasa", movementDate: hoje },
      ctx,
    );
    await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: hoje,
        freight: 0,
        items: [{ productId, quantity: 10, unitPrice: 2 }],
      },
      ctx,
    );

    const conta = await FiadoService.create(
      {
        customerName: "Cliente Caixas",
        customerPhone: "31999990000",
        saleDate: hoje,
        dueDate: hoje,
        plasticCrateQty: 8,
        notes: "Venda no box",
        items: [
          { productId, quantity: 3, unitPrice: 10, recipientType: "PLASTICA", crateQty: 8 },
        ],
      },
      ctx,
    );

    const detalhe = await FiadoService.get(tenantId, conta.id);
    expect(detalhe.totalAmount.toString()).toBe("30"); // 3 * 10
    expect(detalhe.itens).toHaveLength(1);
    expect(detalhe.itens[0]!.productName).toBe("Tomate");
    expect(detalhe.itens[0]!.quantity.toString()).toBe("3");
    expect(detalhe.itens[0]!.unitPrice.toString()).toBe("10");
    expect(detalhe.itens[0]!.lineTotal.toString()).toBe("30");
    expect(detalhe.itens[0]!.recipientType).toBe("PLASTICA");
    expect(detalhe.itens[0]!.crateQty).toBe(8);
    expect(detalhe.plasticCrateQty).toBe(8);
    expect(detalhe.caixasComCliente).toBe(8);
    expect(detalhe.dueDate).not.toBeNull();
    expect(detalhe.customerPhone).toBe("31999990000");
    expect(detalhe.notes).toBe("Venda no box");

    const saldo = await CaixasService.getSaldo(tenantId);
    expect(saldo.limpas).toBe(12);
    expect(saldo.comClientes).toBe(8);

    // O movimento fica rastreável até a venda.
    const movimentos = await CaixasService.listByLink(tenantId, {
      saleId: detalhe.saleId ?? undefined,
    });
    expect(movimentos).toHaveLength(1);
    expect(movimentos[0]!.type).toBe("SAIDA");
    expect(movimentos[0]!.quantity).toBe(8);
  });

  it("devolução de caixas no fiado devolve como sujas", async () => {
    const { contas } = await FiadoService.listOpen(tenantId);
    const conta = contas.find((c) => c.customerName === "Cliente Caixas")!;

    await FiadoService.registrarDevolucaoCaixas(
      { accountId: conta.id, quantity: 5, movementDate: hoje },
      ctx,
    );

    const saldo = await CaixasService.getSaldo(tenantId);
    expect(saldo.comClientes).toBe(3);
    expect(saldo.sujas).toBe(5);
    expect(saldo.limpas).toBe(12); // devolvida NÃO volta limpa

    const detalhe = await FiadoService.get(tenantId, conta.id);
    expect(detalhe.caixasComCliente).toBe(3);
  });

  it("não devolve mais caixas do que o cliente tem", async () => {
    const { contas } = await FiadoService.listOpen(tenantId);
    const conta = contas.find((c) => c.customerName === "Cliente Caixas")!;
    await expect(
      FiadoService.registrarDevolucaoCaixas(
        { accountId: conta.id, quantity: 99, movementDate: hoje },
        ctx,
      ),
    ).rejects.toThrow(/clientes/i);
  });

  it("atualizar a conta muda só os dados cadastrais", async () => {
    const { contas } = await FiadoService.listOpen(tenantId);
    const conta = contas.find((c) => c.customerName === "Cliente Caixas")!;

    const atualizada = await FiadoService.update(
      { id: conta.id, customerPhone: "31888887777", dueDate: null, notes: null },
      ctx,
    );
    expect(atualizada.customerPhone).toBe("31888887777");
    expect(atualizada.dueDate).toBeNull();
    expect(atualizada.totalAmount.toString()).toBe(conta.totalAmount.toString());
    expect(atualizada.paidAmount.toString()).toBe(conta.paidAmount.toString());
    expect(atualizada.status).toBe(conta.status);
  });

  it("o filtro de status separa abertas e quitadas", async () => {
    const abertas = await FiadoService.listOpen(tenantId, "EM_ABERTO");
    const pagas = await FiadoService.listOpen(tenantId, "PAGO");
    const todas = await FiadoService.listOpen(tenantId, "TODAS");

    expect(abertas.contas.every((c) => c.status === "EM_ABERTO")).toBe(true);
    expect(pagas.contas.every((c) => c.status === "PAGO")).toBe(true);
    expect(todas.contas.length).toBe(abertas.contas.length + pagas.contas.length);
    // O total a receber considera apenas as contas em aberto.
    expect(todas.totalGeral.toString()).toBe(abertas.totalGeral.toString());
  });

  it("venda sem caixas plásticas não cria movimento de caixa", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    await VendasService.registrarVenda(
      {
        customerName: "Cliente Sem Caixa",
        paymentMethod: "DINHEIRO",
        items: [{ productId, quantity: 1, unitPrice: 5 }],
      },
      ctx,
    );
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois).toEqual(antes);
  });
});
