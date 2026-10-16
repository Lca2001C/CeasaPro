import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { PainelFinanceiroService, MESES_NO_GRAFICO } from "@/lib/services/painel-financeiro.service";
import { DashboardService } from "@/lib/services/dashboard.service";
import { ComprasService } from "@/lib/services/compras.service";
import { DespesasService } from "@/lib/services/despesas.service";
import { addDaysTz, isoDateTz, refMonthTz, startOfMonthTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * A aba Financeiro do Início: série dos últimos meses, formas de pagamento e
 * contas por categoria — e que ela fecha com os cartões do resumo.
 */

const tenants: string[] = [];
let tenantId = "";
let ctx = makeCtx("");
const agora = new Date();
const hoje = isoDateTz(agora);
const mesPassado = startOfMonthTz(addDaysTz(startOfMonthTz(agora), -1));

beforeAll(async () => {
  tenantId = await createTestTenant("PAINEL FINANCEIRO");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  const db = getTenantPrisma(tenantId);
  const produto = await db.product.create({ data: { tenantId, name: "Banana", saleUnit: "CAIXA" } });

  // Vendas do mês: uma em PIX, uma em dinheiro, e uma mista (parcelas).
  await prisma.sale.create({
    data: { tenantId, paymentMethod: "PIX", totalAmount: 100, saleDate: agora },
  });
  await prisma.sale.create({
    data: { tenantId, paymentMethod: "DINHEIRO", totalAmount: 50, saleDate: agora },
  });
  await prisma.sale.create({
    data: {
      tenantId,
      paymentMethod: "FIADO",
      totalAmount: 80,
      saleDate: agora,
      payments: {
        create: [
          { tenantId, method: "PIX", amount: 30 },
          { tenantId, method: "FIADO", amount: 50 },
        ],
      },
    },
  });
  // Venda cancelada não conta; venda do mês passado vai para o mês dela.
  await prisma.sale.create({
    data: { tenantId, paymentMethod: "PIX", totalAmount: 999, saleDate: agora, cancelledAt: agora },
  });
  await prisma.sale.create({
    data: { tenantId, paymentMethod: "DINHEIRO", totalAmount: 40, saleDate: mesPassado },
  });

  // Compra (gera conta de COMPRA — não pode entrar em "contas por categoria").
  await ComprasService.registrarCompra(
    { purchaseDate: hoje, freight: 0, items: [{ productId: produto.id, quantity: 10, unitPrice: 6 }] },
    ctx,
  );
  // Contas operacionais do mês.
  const luz = await prisma.expenseCategory.create({ data: { tenantId, name: "Energia" } });
  await DespesasService.create(
    { description: "Luz", amount: 120, type: "FIXA", status: "PENDENTE", dueDate: hoje, categoryId: luz.id },
    ctx,
  );
  await DespesasService.create(
    { description: "Gás", amount: 30, type: "VARIAVEL", status: "PENDENTE", dueDate: hoje },
    ctx,
  );
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

describe("PainelFinanceiroService", () => {
  it("série dos últimos meses: vendas, compras e contas operacionais, no mês certo", async () => {
    const p = await PainelFinanceiroService.get(tenantId, agora);
    expect(p.meses).toHaveLength(MESES_NO_GRAFICO);
    expect(p.meses.at(-1)!.mes).toBe(refMonthTz(agora));

    const atual = p.meses.at(-1)!;
    expect(atual.vendas).toBe(230);
    expect(atual.compras).toBe(60);
    // A conta da compra (R$ 60) fica fora: já está no custo da mercadoria.
    expect(atual.contas).toBe(150);

    const anterior = p.meses.at(-2)!;
    expect(anterior.mes).toBe(refMonthTz(mesPassado));
    expect(anterior.vendas).toBe(40);
  });

  it("formas de pagamento: venda mista vale pelas parcelas; cancelada não conta", async () => {
    const p = await PainelFinanceiroService.get(tenantId, agora);
    const por = Object.fromEntries(p.formasDePagamento.map((f) => [f.chave, f.total]));
    expect(por).toEqual({ PIX: 130, DINHEIRO: 50, FIADO: 50 });
    // Ordenado do maior para o menor.
    expect(p.formasDePagamento[0]!.chave).toBe("PIX");
  });

  it("contas por categoria: só operacionais, sem categoria vira 'Sem categoria'", async () => {
    const p = await PainelFinanceiroService.get(tenantId, agora);
    expect(p.contasPorCategoria).toEqual([
      { chave: "Energia", total: 120 },
      { chave: "Sem categoria", total: 30 },
    ]);
  });

  it("fecha com os cartões do resumo do mês", async () => {
    const [p, s] = await Promise.all([
      PainelFinanceiroService.get(tenantId, agora),
      DashboardService.getSummary(tenantId, ctx.session.modules),
    ]);
    expect(p.meses.at(-1)!.vendas).toBe(Number(s.mesVendi));
    expect(p.meses.at(-1)!.compras).toBe(Number(s.totalCompradoMes));
    // Resultado do mês: vendi − custo − contas = sobrou.
    expect(Number(s.mesVendi) - Number(s.cmvMes) - Number(s.despesasLucroMes)).toBeCloseTo(
      Number(s.lucroMes),
      2,
    );
  });
});
