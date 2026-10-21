import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { ComprasService } from "@/lib/services/compras.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { ProdutosService } from "@/lib/services/produtos.service";
import { DashboardService } from "@/lib/services/dashboard.service";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { COMPRA_EXPENSE_CATEGORY } from "@/lib/constants";
import { isoDateTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Correções da varredura de 21/10 que dependem de banco: idempotência dos
 * lançamentos de estoque/embalagem/higienização, baixa de embalagem, caixas por
 * cliente sem diferenciar maiúscula e o ajuste de produto excluído.
 */

const tenants: string[] = [];
let tenantId = "";
let ctx = makeCtx("");
const hoje = isoDateTz();
const sufixo = () => randomUUID().slice(0, 6);

beforeAll(async () => {
  tenantId = await createTestTenant("VARREDURA 21-10");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  await prisma.expenseCategory.create({
    data: { tenantId, name: COMPRA_EXPENSE_CATEGORY, isDefault: true },
  });
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

async function produtoComEstoque(nome: string, qtd = 50, custo = 10) {
  const p = await getTenantPrisma(tenantId).product.create({
    data: { tenantId, name: `${nome} ${sufixo()}`, saleUnit: "CAIXA" },
  });
  await ComprasService.registrarCompra(
    { purchaseDate: hoje, freight: 0, items: [{ productId: p.id, quantity: qtd, unitPrice: custo }] },
    ctx,
  );
  return p.id;
}

async function tipoComEstoque(qtd: number, custo: number) {
  const tipo = await prisma.packagingType.create({
    data: { tenantId, name: `Saco ${sufixo()}` },
  });
  await EmbalagensService.ativarControleEstoque({ packagingTypeId: tipo.id, quantidadeAtual: 0 }, ctx);
  if (qtd > 0) {
    await EmbalagensService.registrarEntrada({ packagingTypeId: tipo.id, quantity: qtd, unitCost: custo }, ctx);
  }
  return tipo.id;
}

describe("idempotência: o reenvio do mesmo lançamento não grava duas vezes", () => {
  it("ajuste de estoque", async () => {
    const produto = await produtoComEstoque("Chuchu");
    const idempotencyKey = randomUUID();
    const input = { productId: produto, type: "QUEBRA" as const, quantity: 5, reason: null, idempotencyKey };
    const a = await EstoqueService.registrarAjuste(input, ctx);
    const b = await EstoqueService.registrarAjuste(input, ctx);
    expect(b.id).toBe(a.id);
    expect(Number(await EstoqueService.getQuantity(tenantId, produto))).toBe(45);
  });

  it("entrada e venda de embalagem", async () => {
    const tipo = await tipoComEstoque(0, 0);
    const kEntrada = randomUUID();
    const entrada = { packagingTypeId: tipo, quantity: 20, unitCost: 2, idempotencyKey: kEntrada };
    const e1 = await EmbalagensService.registrarEntrada(entrada, ctx);
    const e2 = await EmbalagensService.registrarEntrada(entrada, ctx);
    expect(e2.id).toBe(e1.id);
    expect(await prisma.expense.count({ where: { tenantId, origem: "COMPRA_EMBALAGEM", packagingMovementId: e1.id } })).toBe(1);

    const kVenda = randomUUID();
    const venda = {
      packagingTypeId: tipo,
      customerName: null,
      saleDate: hoje,
      quantity: 5,
      unitPrice: 4,
      idempotencyKey: kVenda,
    };
    const v1 = await EmbalagensService.createSale(venda, ctx);
    const v2 = await EmbalagensService.createSale(venda, ctx);
    expect(v2.id).toBe(v1.id);
    expect((await EmbalagensService.saldos(tenantId)).get(tipo)).toBe(15);
  });

  it("envio para higienização", async () => {
    await CaixasService.registrar({ type: "ENTRADA", quantity: 10, dirty: true, movementDate: hoje }, ctx);
    const idempotencyKey = randomUUID();
    const input = {
      cleanerName: `Lava ${sufixo()}`,
      sentDate: hoje,
      sentQty: 10,
      unitPrice: 1,
      notes: null,
      idempotencyKey,
    };
    const a = await HigienizacaoService.create(input, ctx);
    const b = await HigienizacaoService.create(input, ctx);
    expect(b.id).toBe(a.id);
    expect(await prisma.crateCleaning.count({ where: { tenantId, idempotencyKey } })).toBe(1);
  });
});

describe("baixa de embalagem (quebra, molhou, sumiu)", () => {
  it("sai pelo custo médio e entra no custo das embalagens do mês", async () => {
    const tipo = await tipoComEstoque(10, 3);
    const antes = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    await EmbalagensService.registrarBaixa({ packagingTypeId: tipo, quantity: 4, motivo: "molhou" }, ctx);
    const depois = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");

    expect((await EmbalagensService.saldos(tenantId)).get(tipo)).toBe(6);
    expect(Number(depois.custoEmbalagensMes) - Number(antes.custoEmbalagensMes)).toBe(12);
    expect(Number(antes.lucroMes) - Number(depois.lucroMes)).toBe(12);
  });

  it("recusa baixar mais do que o saldo", async () => {
    const tipo = await tipoComEstoque(3, 1);
    await expect(
      EmbalagensService.registrarBaixa({ packagingTypeId: tipo, quantity: 4, motivo: "sumiu" }, ctx),
    ).rejects.toThrow();
    expect((await EmbalagensService.saldos(tenantId)).get(tipo)).toBe(3);
  });
});

describe("caixas com o cliente: o nome não diferencia maiúscula", () => {
  // Os espaços nas pontas os schemas já aparam; aqui o serviço é chamado direto.
  it("'João' e 'JOÃO' são a mesma pessoa no saldo e no retorno", async () => {
    const nome = `João ${sufixo()}`;
    await CaixasService.registrar({ type: "ENTRADA", quantity: 10, movementDate: hoje }, ctx);
    await CaixasService.registrar({ type: "SAIDA", quantity: 6, customerName: nome, movementDate: hoje }, ctx);
    await CaixasService.registrar(
      { type: "SAIDA", quantity: 2, customerName: nome.toLocaleUpperCase("pt-BR"), movementDate: hoje },
      ctx,
    );
    const saldo = await CaixasService.saldoPorCliente(tenantId);
    expect(saldo.get(nome.toLocaleLowerCase("pt-BR"))).toBe(8);

    // Antes o retorno com a grafia diferente era recusado ("o cliente não tem caixas").
    await CaixasService.registrar(
      { type: "RETORNO", quantity: 8, customerName: nome.toLocaleLowerCase("pt-BR"), movementDate: hoje },
      ctx,
    );
    expect((await CaixasService.saldoPorCliente(tenantId)).get(nome) ?? 0).toBe(0);
  });
});

describe("ajuste de produto excluído", () => {
  it("some da lista de ajustes e não pode mais ser desfeito", async () => {
    const produto = await produtoComEstoque("Inhame", 10, 4);
    const ajuste = await EstoqueService.registrarAjuste(
      { productId: produto, type: "QUEBRA", quantity: 2, reason: null },
      ctx,
    );
    await ProdutosService.remove(produto, ctx);

    const recentes = await EstoqueService.ajustesRecentes(tenantId);
    expect(recentes.some((a) => a.id === ajuste.id)).toBe(false);
    await expect(EstoqueService.desfazerAjuste({ id: ajuste.id }, ctx)).rejects.toThrow();
    expect(await prisma.stockMovement.count({ where: { productId: produto, sourceType: "MANUAL_CANCELLED" } })).toBe(0);
  });
});
