import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CaixasService } from "@/lib/services/caixas.service";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

let tenantId = "";
let ctx = makeCtx("");

beforeAll(async () => {
  tenantId = await createTestTenant("FASE2");
  ctx = makeCtx(tenantId);
});

afterAll(async () => {
  await cleanupTenants([tenantId]);
});

const hoje = new Date().toISOString().slice(0, 10);

describe("Caixas plásticas — saldos derivados do ledger", () => {
  it("entrada de 100 boas + 5 quebradas", async () => {
    await CaixasService.registrar(
      { type: "ENTRADA", quantity: 100, brokenQty: 5, supplierName: "Ceasa", movementDate: hoje },
      ctx,
    );
    const s = await CaixasService.getSaldo(tenantId);
    expect(s).toEqual({ vazias: 100, comClientes: 0, perdidas: 5 });
  });

  it("saída de 30 para cliente", async () => {
    await CaixasService.registrar(
      { type: "SAIDA", quantity: 30, customerName: "Mercadinho A", movementDate: hoje },
      ctx,
    );
    const s = await CaixasService.getSaldo(tenantId);
    expect(s).toEqual({ vazias: 70, comClientes: 30, perdidas: 5 });
  });

  it("retorno de 10 do cliente", async () => {
    await CaixasService.registrar(
      { type: "RETORNO", quantity: 10, customerName: "Mercadinho A", movementDate: hoje },
      ctx,
    );
    const s = await CaixasService.getSaldo(tenantId);
    expect(s).toEqual({ vazias: 80, comClientes: 20, perdidas: 5 });
  });

  it("quebra no estoque (2) e sumiço com cliente (3)", async () => {
    await CaixasService.registrar(
      { type: "QUEBRA", quantity: 2, movementDate: hoje },
      ctx,
    );
    await CaixasService.registrar(
      { type: "QUEBRA", quantity: 3, customerName: "Mercadinho A", movementDate: hoje },
      ctx,
    );
    const s = await CaixasService.getSaldo(tenantId);
    expect(s).toEqual({ vazias: 78, comClientes: 17, perdidas: 10 });
  });

  it("bloqueia saída acima das caixas vazias", async () => {
    await expect(
      CaixasService.registrar(
        { type: "SAIDA", quantity: 999, customerName: "X", movementDate: hoje },
        ctx,
      ),
    ).rejects.toThrow(/vazia/i);
  });

  it("bloqueia retorno acima das caixas com clientes", async () => {
    await expect(
      CaixasService.registrar(
        { type: "RETORNO", quantity: 999, customerName: "X", movementDate: hoje },
        ctx,
      ),
    ).rejects.toThrow(/clientes/i);
  });
});

describe("Higienização — envio, devolução e pagamento", () => {
  let id = "";

  it("registra envio: 50 caixas × R$ 1,50 = R$ 75,00", async () => {
    const c = await HigienizacaoService.create(
      { cleanerName: "Higienizadora BH", sentDate: hoje, sentQty: 50, unitPrice: 1.5 },
      ctx,
    );
    id = c.id;
    expect(c.totalAmount.toString()).toBe("75");
    expect(c.status).toBe("ENVIADO");
  });

  it("devolução parcial (30) → 20 a receber", async () => {
    const c = await HigienizacaoService.registrarDevolucao(
      { id, quantity: 30, returnedDate: hoje },
      ctx,
    );
    expect(c.returnedQty).toBe(30);
    expect(c.status).toBe("ENVIADO");
  });

  it("bloqueia devolução acima do enviado", async () => {
    await expect(
      HigienizacaoService.registrarDevolucao({ id, quantity: 999, returnedDate: hoje }, ctx),
    ).rejects.toThrow(/devolver/i);
  });

  it("devolução final (20) → status DEVOLVIDO", async () => {
    const c = await HigienizacaoService.registrarDevolucao(
      { id, quantity: 20, returnedDate: hoje },
      ctx,
    );
    expect(c.status).toBe("DEVOLVIDO");
  });

  it("pagamento parcial (40) mantém em aberto; final (35) quita", async () => {
    const p1 = await HigienizacaoService.registrarPagamento(
      { id, amount: 40, paidDate: hoje },
      ctx,
    );
    expect(p1.status).toBe("DEVOLVIDO");
    const p2 = await HigienizacaoService.registrarPagamento(
      { id, amount: 35, paidDate: hoje },
      ctx,
    );
    expect(p2.status).toBe("PAGO");
    expect(p2.paidAmount.toString()).toBe("75");
  });

  it("bloqueia pagamento acima do saldo", async () => {
    await expect(
      HigienizacaoService.registrarPagamento({ id, amount: 10, paidDate: hoje }, ctx),
    ).rejects.toThrow(/saldo/i);
  });
});

describe("Venda de embalagens", () => {
  it("cria tipo e registra venda com total calculado", async () => {
    const tipo = await EmbalagensService.createType({ name: "Sacaria" }, ctx);
    const venda = await EmbalagensService.createSale(
      {
        packagingTypeId: tipo.id,
        customerName: "Cliente Z",
        saleDate: hoje,
        quantity: 10,
        unitPrice: 2.5,
      },
      ctx,
    );
    expect(venda.totalAmount.toString()).toBe("25");

    const { total, totalQtd } = await EmbalagensService.listSales(tenantId);
    expect(totalQtd).toBe(10);
    expect(total.toString()).toBe("25");
  });

  it("bloqueia tipo duplicado", async () => {
    await expect(EmbalagensService.createType({ name: "Sacaria" }, ctx)).rejects.toThrow(
      /existe/i,
    );
  });
});
