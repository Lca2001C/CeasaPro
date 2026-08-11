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
    expect(s).toEqual({
      limpas: 100,
      sujas: 0,
      emHigienizacao: 0,
      comClientes: 0,
      perdidas: 5,
      vazias: 100,
    });
  });

  it("saída de 30 para cliente sai das limpas", async () => {
    await CaixasService.registrar(
      { type: "SAIDA", quantity: 30, customerName: "Mercadinho A", movementDate: hoje },
      ctx,
    );
    const s = await CaixasService.getSaldo(tenantId);
    expect(s.limpas).toBe(70);
    expect(s.comClientes).toBe(30);
  });

  it("retorno de 10 do cliente entra como suja", async () => {
    await CaixasService.registrar(
      { type: "RETORNO", quantity: 10, customerName: "Mercadinho A", movementDate: hoje },
      ctx,
    );
    const s = await CaixasService.getSaldo(tenantId);
    expect(s.limpas).toBe(70);
    expect(s.sujas).toBe(10);
    expect(s.comClientes).toBe(20);
    expect(s.vazias).toBe(80); // limpas + sujas = fórmula antiga de "vazias"
  });

  it("quebra no estoque (2) e sumiço com cliente (3)", async () => {
    await CaixasService.registrar({ type: "QUEBRA", quantity: 2, movementDate: hoje }, ctx);
    await CaixasService.registrar(
      { type: "QUEBRA", quantity: 3, customerName: "Mercadinho A", movementDate: hoje },
      ctx,
    );
    const s = await CaixasService.getSaldo(tenantId);
    expect(s.limpas).toBe(68);
    expect(s.sujas).toBe(10);
    expect(s.comClientes).toBe(17);
    expect(s.perdidas).toBe(10);
    expect(s.vazias).toBe(78);
  });

  it("bloqueia saída acima das caixas limpas", async () => {
    await expect(
      CaixasService.registrar(
        { type: "SAIDA", quantity: 999, customerName: "X", movementDate: hoje },
        ctx,
      ),
    ).rejects.toThrow(/limpa/i);
  });

  it("bloqueia retorno acima das caixas com clientes", async () => {
    await expect(
      CaixasService.registrar(
        { type: "RETORNO", quantity: 999, customerName: "X", movementDate: hoje },
        ctx,
      ),
    ).rejects.toThrow(/clientes/i);
  });

  it("expõe o saldo de caixas por cliente", async () => {
    const porCliente = await CaixasService.saldoPorCliente(tenantId);
    expect(porCliente.get("Mercadinho A")).toBe(17);
  });
});

describe("Higienização — envio, devolução e pagamento", () => {
  let id = "";

  it("bloqueia envio acima das caixas sujas em estoque", async () => {
    // Só há 10 sujas neste ponto do fluxo.
    await expect(
      HigienizacaoService.create(
        { cleanerName: "Higienizadora BH", sentDate: hoje, sentQty: 50, unitPrice: 1.5 },
        ctx,
      ),
    ).rejects.toThrow(/suja/i);
  });

  it("registra envio: 50 caixas × R$ 1,50 = R$ 75,00 e baixa as sujas", async () => {
    // Entrada de 50 caixas sujas (ex.: recebidas com mercadoria) → 60 sujas.
    await CaixasService.registrar(
      { type: "ENTRADA", quantity: 50, dirty: true, supplierName: "Ceasa", movementDate: hoje },
      ctx,
    );
    expect((await CaixasService.getSaldo(tenantId)).sujas).toBe(60);

    const c = await HigienizacaoService.create(
      { cleanerName: "Higienizadora BH", sentDate: hoje, sentQty: 50, unitPrice: 1.5 },
      ctx,
    );
    id = c.id;
    expect(c.totalAmount.toString()).toBe("75");
    expect(c.status).toBe("ENVIADO");

    const s = await CaixasService.getSaldo(tenantId);
    expect(s.sujas).toBe(10);
    expect(s.emHigienizacao).toBe(50);
    expect(s.limpas).toBe(68); // ainda não voltou nada
  });

  it("devolução parcial (30) → 20 a receber e 30 voltam limpas", async () => {
    const c = await HigienizacaoService.registrarDevolucao(
      { id, quantity: 30, returnedDate: hoje },
      ctx,
    );
    expect(c.returnedQty).toBe(30);
    expect(c.status).toBe("ENVIADO");

    const s = await CaixasService.getSaldo(tenantId);
    expect(s.emHigienizacao).toBe(20);
    expect(s.limpas).toBe(98);
  });

  it("bloqueia devolução acima do enviado", async () => {
    await expect(
      HigienizacaoService.registrarDevolucao({ id, quantity: 999, returnedDate: hoje }, ctx),
    ).rejects.toThrow(/devolver/i);
  });

  it("devolução final (20) → status DEVOLVIDO e nada mais no higienizador", async () => {
    const c = await HigienizacaoService.registrarDevolucao(
      { id, quantity: 20, returnedDate: hoje },
      ctx,
    );
    expect(c.status).toBe("DEVOLVIDO");

    const s = await CaixasService.getSaldo(tenantId);
    expect(s.emHigienizacao).toBe(0);
    expect(s.limpas).toBe(118);
  });

  it("registra os movimentos de caixa vinculados ao lote", async () => {
    const c = await HigienizacaoService.get(tenantId, id);
    expect(c.movimentos).toHaveLength(3); // 1 saída + 2 devoluções
    expect(c.movimentos[0]!.type).toBe("SAIDA_HIGIENIZACAO");
  });

  it("bloqueia edição depois da devolução", async () => {
    await expect(
      HigienizacaoService.update(
        { id, cleanerName: "Outra", sentDate: hoje, sentQty: 10, unitPrice: 1 },
        ctx,
      ),
    ).rejects.toThrow(/alterado/i);
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

  it("excluir um envio pendente estorna as caixas no higienizador", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    const novo = await HigienizacaoService.create(
      { cleanerName: "Higienizadora 2", sentDate: hoje, sentQty: 5, unitPrice: 1 },
      ctx,
    );
    expect((await CaixasService.getSaldo(tenantId)).emHigienizacao).toBe(5);

    await HigienizacaoService.remove(novo.id, ctx);
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.emHigienizacao).toBe(0);
    expect(depois.limpas).toBe(antes.limpas + 5); // voltaram limpas
    expect(depois.sujas).toBe(antes.sujas - 5);
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
