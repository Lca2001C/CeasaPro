import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { ComprasService } from "@/lib/services/compras.service";
import { DespesasService } from "@/lib/services/despesas.service";
import { DashboardService } from "@/lib/services/dashboard.service";
import { ContasPagarService } from "@/lib/services/contas-pagar.service";
import { AvisosService } from "@/lib/services/avisos.service";
import { buildReport } from "@/lib/reports/report.service";
import { resolvePeriod } from "@/lib/dates";
import { addDaysTz, isoDateTz } from "@/lib/tz";
import { COMPRA_EXPENSE_CATEGORY } from "@/lib/constants";
import type { CompraInput } from "@/lib/validations/compra";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Toda compra vira UMA despesa (`origem = COMPRA`) no valor total, ligada ao
 * fornecedor — e entra em Contas a Pagar e no caixa, mas NÃO no lucro: o custo
 * da mercadoria (com o frete) já está no CMV pelo `unitCost` das entradas.
 */

const tenants: string[] = [];
let tenantId = "";
let ctx = makeCtx("");
let productId = "";
let supplierId = "";
const hoje = isoDateTz();
const dia = (offset: number) => isoDateTz(addDaysTz(new Date(), offset));

beforeAll(async () => {
  tenantId = await createTestTenant("COMPRA DESPESA");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  const db = getTenantPrisma(tenantId);
  await prisma.expenseCategory.create({
    data: { tenantId, name: COMPRA_EXPENSE_CATEGORY, isDefault: true },
  });
  productId = (await db.product.create({ data: { tenantId, name: "Tomate", saleUnit: "CAIXA" } }))
    .id;
  supplierId = (await db.supplier.create({ data: { tenantId, name: "Sítio Boa Vista" } })).id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

beforeEach(async () => {
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.stockMovement.deleteMany({ where: { tenantId } });
  await prisma.purchaseItem.deleteMany({ where: { tenantId } });
  await prisma.purchase.deleteMany({ where: { tenantId } });
});

function compra(extra: Partial<CompraInput> = {}): CompraInput {
  return {
    supplierId,
    purchaseDate: hoje,
    freight: 20,
    items: [{ productId, quantity: 10, unitPrice: 50 }],
    ...extra,
  };
}

const despesaDa = (purchaseId: string) =>
  prisma.expense.findFirstOrThrow({ where: { tenantId, purchaseId, origem: "COMPRA" } });

describe("compra gera a despesa", () => {
  it("paga agora: despesa PAGA no total (itens + frete), com fornecedor e categoria", async () => {
    const p = await ComprasService.registrarCompra(
      compra({ pagamento: { status: "PAGO", paymentMethod: "PIX" } }),
      ctx,
    );
    const e = await despesaDa(p.id);
    expect(Number(e.amount)).toBe(520);
    expect(e.status).toBe("PAGO");
    expect(isoDateTz(e.paidDate!)).toBe(hoje);
    expect(e.paymentMethod).toBe("PIX");
    expect(e.supplierId).toBe(supplierId);
    expect(e.description).toContain("Sítio Boa Vista");
    expect(e.recurring).toBe(false);
    const cat = await prisma.expenseCategory.findUniqueOrThrow({ where: { id: e.categoryId! } });
    expect(cat.name).toBe(COMPRA_EXPENSE_CATEGORY);
  });

  it("sem `pagamento` (API antiga) é tratada como paga na data da compra", async () => {
    const p = await ComprasService.registrarCompra(compra(), ctx);
    const e = await despesaDa(p.id);
    expect(e.status).toBe("PAGO");
  });

  it("a prazo: PENDENTE até o vencimento, em contas a pagar e nos avisos", async () => {
    const p = await ComprasService.registrarCompra(
      compra({ pagamento: { status: "PENDENTE", dueDate: dia(3) } }),
      ctx,
    );
    const e = await despesaDa(p.id);
    expect(e.status).toBe("PENDENTE");
    expect(isoDateTz(e.dueDate!)).toBe(dia(3));
    expect(e.paidDate).toBeNull();

    const contas = await ContasPagarService.get(tenantId);
    expect(Number(contas.total)).toBe(520);
    expect(Number(contas.totalProximosSeteDias)).toBe(520);

    const avisos = await AvisosService.get(tenantId);
    expect(avisos.some((a) => a.tipo === "despesa_a_vencer")).toBe(true);
  });

  it("compra de valor zero (bonificação) não gera conta", async () => {
    const p = await ComprasService.registrarCompra(
      compra({ freight: 0, items: [{ productId, quantity: 2, unitPrice: 0 }] }),
      ctx,
    );
    expect(await prisma.expense.count({ where: { tenantId, purchaseId: p.id } })).toBe(0);
  });

  it("vencimento antes da compra é recusado", async () => {
    await expect(
      ComprasService.registrarCompra(
        compra({ pagamento: { status: "PENDENTE", dueDate: dia(-2) } }),
        ctx,
      ),
    ).rejects.toThrow(/antes da data da compra/);
    expect(await prisma.purchase.count({ where: { tenantId } })).toBe(0);
  });

  it("o banco garante uma despesa de COMPRA por compra", async () => {
    const p = await ComprasService.registrarCompra(compra(), ctx);
    await expect(
      prisma.expense.create({
        data: {
          tenantId,
          origem: "COMPRA",
          purchaseId: p.id,
          description: "duplicada",
          amount: 1,
          type: "VARIAVEL",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("a despesa da compra não conta a mercadoria duas vezes", () => {
  it("lucro do mês e Fixas/Variáveis ignoram a compra; a pagar e pagas a incluem", async () => {
    const antes = await DashboardService.getSummary(tenantId);
    const resumoAntes = await DespesasService.resumoMes(tenantId);

    await ComprasService.registrarCompra(
      compra({ pagamento: { status: "PENDENTE", dueDate: dia(1) } }),
      ctx,
    );
    await ComprasService.registrarCompra(compra({ pagamento: { status: "PAGO" } }), ctx);

    const depois = await DashboardService.getSummary(tenantId);
    const resumo = await DespesasService.resumoMes(tenantId);

    expect(Number(depois.lucroMes)).toBe(Number(antes.lucroMes));
    expect(Number(resumo.variaveis)).toBe(Number(resumoAntes.variaveis));
    expect(Number(resumo.fixas)).toBe(Number(resumoAntes.fixas));
    expect(Number(resumo.percentualDoFaturamento)).toBe(
      Number(resumoAntes.percentualDoFaturamento),
    );
    // Mas é dinheiro devido e dinheiro que saiu.
    expect(Number(resumo.pagas) - Number(resumoAntes.pagas)).toBe(520);
  });

  it("fluxo de caixa: a compra a prazo sai no dia em que é PAGA, uma vez só", async () => {
    const p = await ComprasService.registrarCompra(
      compra({ purchaseDate: dia(-4), pagamento: { status: "PENDENTE", dueDate: dia(-1) } }),
      ctx,
    );
    const e = await despesaDa(p.id);
    await DespesasService.marcarComoPago({ id: e.id, paidDate: dia(-1) }, ctx);

    const periodo = resolvePeriod({ preset: "personalizado", from: dia(-6), to: dia(0) });
    const rel = await buildReport("FLUXO_CAIXA", { tenantId, from: periodo.from, to: periodo.to });
    const saidaEm = (offset: number) => {
      const linha = rel.rows.find((r) => isoDateTz(r.date as Date) === dia(offset));
      return Number((linha?.saidas as { toString(): string } | undefined)?.toString() ?? 0);
    };
    expect(saidaEm(-4)).toBe(0);
    expect(saidaEm(-1)).toBe(520);
  });

  it("replicar o mês não copia a compra", async () => {
    await ComprasService.registrarCompra(
      compra({ purchaseDate: dia(-1), pagamento: { status: "PENDENTE", dueDate: hoje } }),
      ctx,
    );
    await expect(DespesasService.replicarMes(hoje.slice(0, 7), ctx)).rejects.toThrow(
      /Não há despesas/,
    );
  });
});

describe("a conta da compra é travada", () => {
  it("não muda de valor, não exclui e não duplica — mas pode ser paga", async () => {
    const p = await ComprasService.registrarCompra(
      compra({ pagamento: { status: "PENDENTE", dueDate: dia(5) } }),
      ctx,
    );
    const e = await despesaDa(p.id);

    await expect(
      DespesasService.update(
        {
          id: e.id,
          description: e.description,
          amount: 1,
          type: "VARIAVEL",
          status: "PENDENTE",
          dueDate: dia(5),
        },
        ctx,
      ),
    ).rejects.toThrow(/vem da compra/);
    await expect(DespesasService.remove(e.id, ctx)).rejects.toThrow(/vem de uma compra/);
    await expect(DespesasService.dadosParaDuplicar(tenantId, e.id)).rejects.toThrow(
      /não pode ser duplicada/,
    );

    // Mudar o vencimento e a forma continua possível; a descrição fica a da compra.
    const editada = await DespesasService.update(
      {
        id: e.id,
        description: "outra coisa",
        amount: 520,
        type: "FIXA",
        status: "PENDENTE",
        paymentMethod: "BOLETO",
        dueDate: dia(10),
      },
      ctx,
    );
    expect(editada.description).toBe(e.description);
    expect(editada.type).toBe("VARIAVEL");
    expect(editada.paymentMethod).toBe("BOLETO");
    expect(isoDateTz(editada.dueDate!)).toBe(dia(10));

    const paga = await DespesasService.marcarComoPago({ id: e.id }, ctx);
    expect(paga.status).toBe("PAGO");
  });

  it("filtro por origem e por fornecedor", async () => {
    await ComprasService.registrarCompra(compra(), ctx);
    await DespesasService.create(
      { description: "Luz", amount: 90, type: "FIXA", status: "PENDENTE", dueDate: hoje },
      ctx,
    );
    const compras = await DespesasService.list(tenantId, { origem: "COMPRA" });
    const operacionais = await DespesasService.list(tenantId, { origem: "OPERACIONAL" });
    const doFornecedor = await DespesasService.list(tenantId, { supplierId });
    expect(compras.map((d) => d.description).every((d) => d.startsWith("Compra"))).toBe(true);
    expect(operacionais.map((d) => d.description)).toEqual(["Luz"]);
    expect(doFornecedor).toHaveLength(1);
  });
});
