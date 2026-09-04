import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { DespesasService } from "@/lib/services/despesas.service";
import { ContasPagarService } from "@/lib/services/contas-pagar.service";
import { AvisosService } from "@/lib/services/avisos.service";
import { createDefaultExpenseCategories } from "@/lib/services/expense-categories";
import { isoDateTz, startOfDayTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * O que estes testes protegem, na ordem em que o dono do box usa o módulo:
 * pagar em um toque, ver o que está atrasado, não relançar conta fixa todo mês,
 * e enxergar tudo que tem para pagar num lugar só.
 */

const tenants: string[] = [];
let tenantId = "";
let ctx = makeCtx("");

const HOJE = new Date("2026-09-03T12:00:00.000Z");
const ontem = isoDateTz(new Date(HOJE.getTime() - 864e5));
const hoje = isoDateTz(HOJE);
const amanha = isoDateTz(new Date(HOJE.getTime() + 864e5));

beforeAll(async () => {
  tenantId = await createTestTenant("DESPESAS FLUXO");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

beforeEach(async () => {
  await prisma.expense.deleteMany({ where: { tenantId } });
});

async function criar(patch: Partial<Parameters<typeof DespesasService.create>[0]> = {}) {
  return DespesasService.create(
    {
      description: "Aluguel do box",
      amount: 1200,
      type: "FIXA",
      status: "PENDENTE",
      dueDate: hoje,
      ...patch,
    },
    ctx,
  );
}

describe("Marcar como pago em um toque", () => {
  it("quita com a data de hoje sem precisar do formulário", async () => {
    const d = await criar();
    const pago = await DespesasService.marcarComoPago({ id: d.id }, ctx);

    expect(pago.status).toBe("PAGO");
    expect(pago.paidDate).not.toBeNull();
    expect(isoDateTz(pago.paidDate!)).toBe(isoDateTz());
  });

  it("aceita data e forma de pagamento quando informadas", async () => {
    const d = await criar();
    const pago = await DespesasService.marcarComoPago(
      { id: d.id, paidDate: ontem, paymentMethod: "BOLETO" },
      ctx,
    );
    expect(isoDateTz(pago.paidDate!)).toBe(ontem);
    expect(pago.paymentMethod).toBe("BOLETO");
  });

  it("não paga duas vezes", async () => {
    const d = await criar();
    await DespesasService.marcarComoPago({ id: d.id }, ctx);
    await expect(DespesasService.marcarComoPago({ id: d.id }, ctx)).rejects.toThrow(/já está paga/i);
  });

  it("desfazer devolve a conta para pendente e limpa a data", async () => {
    const d = await criar();
    await DespesasService.marcarComoPago({ id: d.id }, ctx);
    const volta = await DespesasService.marcarComoPendente(d.id, ctx);
    expect(volta.status).toBe("PENDENTE");
    expect(volta.paidDate).toBeNull();
  });
});

describe("Filtro de vencidas", () => {
  it("lista só as pendentes com vencimento no passado", async () => {
    const vencida = await criar({ description: "Luz (atrasada)", dueDate: ontem });
    await criar({ description: "Internet (hoje)", dueDate: hoje });
    await criar({ description: "Água (amanhã)", dueDate: amanha });
    const paga = await criar({ description: "Gás (paga com atraso)", dueDate: ontem });
    await DespesasService.marcarComoPago({ id: paga.id }, ctx);

    const lista = await DespesasService.list(tenantId, { vencidas: true }, HOJE);
    expect(lista.map((d) => d.id)).toEqual([vencida.id]);

    // Conta que vence HOJE não está vencida, e paga com atraso já foi resolvida.
    const count = await DespesasService.count(tenantId, { vencidas: true }, HOJE);
    expect(count).toBe(1);
  });

  it("o aviso do dashboard aponta para a conta quando é uma só", async () => {
    const vencida = await criar({ description: "Luz", dueDate: ontem });
    const avisos = await AvisosService.get(tenantId, HOJE);
    const aviso = avisos.find((a) => a.tipo === "despesa_vencida");
    expect(aviso?.href).toBe(`/despesas/${vencida.id}`);
  });

  it("com mais de uma vencida, aponta para a lista já filtrada", async () => {
    await criar({ description: "Luz", dueDate: ontem });
    await criar({ description: "Água", dueDate: ontem });
    const avisos = await AvisosService.get(tenantId, HOJE);
    const aviso = avisos.find((a) => a.tipo === "despesa_vencida");
    expect(aviso?.count).toBe(2);
    expect(aviso?.href).toBe("/despesas?vencidas=1");
  });
});

describe("Busca e filtros extras", () => {
  beforeEach(async () => {
    await criar({ description: "Conta de LUZ do box", type: "FIXA", dueDate: hoje });
    await criar({ description: "Combustível", type: "VARIAVEL", dueDate: hoje });
  });

  it("busca por descrição ignora maiúsculas", async () => {
    const r = await DespesasService.list(tenantId, { q: "luz" });
    expect(r).toHaveLength(1);
    expect(r[0]!.description).toContain("LUZ");
  });

  it("filtra por tipo", async () => {
    const r = await DespesasService.list(tenantId, { type: "VARIAVEL" });
    expect(r.map((d) => d.description)).toEqual(["Combustível"]);
  });

  it("filtra por período de pagamento, não só de vencimento", async () => {
    const d = await criar({ description: "Paga ontem", dueDate: ontem });
    await DespesasService.marcarComoPago({ id: d.id, paidDate: ontem }, ctx);

    const porPagamento = await DespesasService.list(tenantId, {
      dateField: "paidDate",
      from: ontem,
      to: ontem,
    });
    expect(porPagamento.map((x) => x.id)).toEqual([d.id]);

    // O mesmo período por VENCIMENTO traz a mesma conta, mas o critério é outro:
    // é essa distinção que o relatório do contador precisava.
    const porVencimento = await DespesasService.list(tenantId, {
      dateField: "dueDate",
      from: hoje,
      to: hoje,
    });
    expect(porVencimento.map((x) => x.id)).not.toContain(d.id);
  });

  it("filtra por categoria", async () => {
    await createDefaultExpenseCategories(tenantId);
    const categorias = await DespesasService.listCategories(tenantId);
    const aluguel = categorias.find((c) => c.name === "Aluguel do box")!;
    const d = await criar({ description: "Aluguel setembro", categoryId: aluguel.id });

    const r = await DespesasService.list(tenantId, { categoryId: aluguel.id });
    expect(r.map((x) => x.id)).toEqual([d.id]);
  });
});

describe("Despesa fixa recorrente", () => {
  it("quitar gera a parcela do mês seguinte como pendente", async () => {
    const d = await criar({ dueDate: "2026-09-10", recurring: true });
    await DespesasService.marcarComoPago({ id: d.id }, ctx);

    const filhas = await prisma.expense.findMany({ where: { tenantId, parentId: d.id } });
    expect(filhas).toHaveLength(1);
    const proxima = filhas[0]!;
    expect(proxima.status).toBe("PENDENTE");
    expect(proxima.paidDate).toBeNull();
    expect(isoDateTz(proxima.dueDate!)).toBe("2026-10-10");
    expect(proxima.amount.toString()).toBe(d.amount.toString());
    // A marca ANDA para a nova parcela: é isso que mantém exatamente um gerador.
    expect(proxima.recurring).toBe(true);
    const origem = await prisma.expense.findUniqueOrThrow({ where: { id: d.id } });
    expect(origem.recurring).toBe(false);
  });

  it("é idempotente: rodar o job de novo não duplica a conta", async () => {
    const d = await criar({ dueDate: "2026-09-10", recurring: true });
    await DespesasService.marcarComoPago({ id: d.id }, ctx);

    const antes = await prisma.expense.count({ where: { tenantId } });
    await DespesasService.gerarRecorrentes(ctx, new Date("2026-09-11T12:00:00.000Z"));
    await DespesasService.gerarRecorrentes(ctx, new Date("2026-09-11T12:00:00.000Z"));
    // A parcela nova vence em outubro, então nem entra como candidata em 11/09.
    expect(await prisma.expense.count({ where: { tenantId } })).toBe(antes);
  });

  it("o job gera a parcela de quem esqueceu de dar baixa", async () => {
    // Continua PENDENTE e já venceu: perder a conta do mês seguinte seria pior
    // do que ter duas em aberto.
    await criar({ dueDate: "2026-08-10", recurring: true });
    const r = await DespesasService.gerarRecorrentes(ctx, new Date("2026-09-03T12:00:00.000Z"));
    expect(r.geradas).toBe(1);

    const todas = await prisma.expense.findMany({ where: { tenantId }, orderBy: { dueDate: "asc" } });
    expect(todas).toHaveLength(2);
    expect(isoDateTz(todas[1]!.dueDate!)).toBe("2026-09-10");
  });

  it("recorrente sem vencimento perde a marca em vez de prometer o impossível", async () => {
    const d = await criar({ dueDate: null, recurring: true });
    await DespesasService.marcarComoPago({ id: d.id }, ctx);

    const depois = await prisma.expense.findUniqueOrThrow({ where: { id: d.id } });
    expect(depois.recurring).toBe(false);
    expect(await prisma.expense.count({ where: { tenantId, parentId: d.id } })).toBe(0);
  });

  it("dia 31 não vaza para o mês seguinte", async () => {
    const d = await criar({ dueDate: "2026-01-31", recurring: true });
    await DespesasService.marcarComoPago({ id: d.id }, ctx);
    const filha = await prisma.expense.findFirstOrThrow({ where: { tenantId, parentId: d.id } });
    expect(isoDateTz(filha.dueDate!)).toBe("2026-02-28");
  });
});

describe("Replicar mês anterior", () => {
  it("copia as contas do mês para o seguinte, sem duplicar em duas execuções", async () => {
    await criar({ description: "Aluguel", dueDate: "2026-08-05" });
    await criar({ description: "Internet", dueDate: "2026-08-15" });

    const r1 = await DespesasService.replicarMes("2026-08", ctx, HOJE);
    expect(r1.encontradas).toBe(2);
    expect(r1.criadas).toBe(2);

    const setembro = await DespesasService.list(tenantId, {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(setembro.map((d) => d.description).sort()).toEqual(["Aluguel", "Internet"]);
    expect(setembro.every((d) => d.status === "PENDENTE")).toBe(true);
    // Replicar é decisão daquele mês, não uma assinatura.
    expect(setembro.every((d) => d.recurring === false)).toBe(true);

    const r2 = await DespesasService.replicarMes("2026-08", ctx, HOJE);
    expect(r2.criadas).toBe(0);
    expect(await prisma.expense.count({ where: { tenantId } })).toBe(4);
  });

  it("recusa com mensagem clara quando o mês de origem está vazio", async () => {
    await expect(DespesasService.replicarMes("2026-01", ctx, HOJE)).rejects.toThrow(
      /não há despesas/i,
    );
  });
});

describe("Duplicar despesa", () => {
  it("devolve os dados prontos, com vencimento no mês seguinte e como pendente", async () => {
    const d = await criar({ description: "Conta de luz", amount: 340.5, dueDate: "2026-09-10" });
    await DespesasService.marcarComoPago({ id: d.id }, ctx);

    const copia = await DespesasService.dadosParaDuplicar(tenantId, d.id);
    expect(copia.description).toBe("Conta de luz");
    expect(copia.amount).toBe(340.5);
    expect(copia.status).toBe("PENDENTE");
    expect(copia.paidDate).toBeNull();
    expect(copia.dueDate).toBe("2026-10-10");
  });

  it('"ultima" pega a despesa mais recente', async () => {
    await criar({ description: "Antiga" });
    const nova = await criar({ description: "Mais nova" });
    const copia = await DespesasService.dadosParaDuplicar(tenantId, "ultima");
    expect(copia.description).toBe(nova.description);
  });
});

describe("Resumo do mês", () => {
  it("separa a pagar, já pago, fixas/variáveis e vencidas", async () => {
    // A pagar no mês (setembro)
    await criar({ description: "Aluguel", amount: 1000, type: "FIXA", dueDate: "2026-09-10" });
    await criar({ description: "Frete", amount: 300, type: "VARIAVEL", dueDate: "2026-09-20" });
    // Vencida (também conta como a pagar do mês)
    await criar({ description: "Luz", amount: 200, type: "FIXA", dueDate: "2026-09-01" });
    // Paga no mês
    const paga = await criar({
      description: "Internet",
      amount: 150,
      type: "FIXA",
      dueDate: "2026-09-05",
    });
    await DespesasService.marcarComoPago({ id: paga.id, paidDate: "2026-09-02" }, ctx);
    // Mês anterior, para o comparativo
    await criar({ description: "Aluguel ago", amount: 900, type: "FIXA", dueDate: "2026-08-10" });

    const r = await DespesasService.resumoMes(tenantId, "2026-09", HOJE);

    expect(r.referencia).toBe("2026-09");
    expect(Number(r.aPagar)).toBe(1500); // 1000 + 300 + 200
    expect(r.aPagarCount).toBe(3);
    expect(Number(r.pagas)).toBe(150);
    expect(r.pagasCount).toBe(1);
    expect(Number(r.fixas)).toBe(1350); // 1000 + 200 + 150 (por vencimento)
    expect(Number(r.variaveis)).toBe(300);
    // Vencidas atravessam o mês de propósito: "Luz" de 01/09 (200) MAIS o
    // aluguel de agosto (900), que continua pendente. O card responde "quanto
    // está atrasado", não "quanto atrasou neste mês".
    expect(Number(r.vencidas)).toBe(1100);
    expect(r.vencidasCount).toBe(2);
    expect(Number(r.fixasMesAnterior)).toBe(900);
    expect(Number(r.variaveisMesAnterior)).toBe(0);
  });

  it("percentual do faturamento não divide por zero sem vendas", async () => {
    await criar({ amount: 500, dueDate: "2026-09-10" });
    const r = await DespesasService.resumoMes(tenantId, "2026-09", HOJE);
    expect(Number(r.faturamento)).toBe(0);
    expect(Number(r.percentualDoFaturamento)).toBe(0);
  });

  it("os totais históricos continuam somando TUDO (contrato antigo preservado)", async () => {
    await criar({ amount: 100, type: "FIXA", dueDate: "2020-01-01" });
    await criar({ amount: 50, type: "VARIAVEL", dueDate: "2026-09-10" });
    const t = await DespesasService.totais(tenantId);
    expect(Number(t.geral)).toBe(150);
  });
});

describe("Próximas contas e tudo a pagar", () => {
  it("lista as contas dos próximos 7 dias, vencidas primeiro", async () => {
    await criar({ description: "Vencida", amount: 100, dueDate: ontem });
    await criar({ description: "Amanhã", amount: 200, dueDate: amanha });
    await criar({ description: "Longe", amount: 999, dueDate: "2026-12-01" });

    const r = await DespesasService.proximasContas(tenantId, 7, HOJE);
    expect(r.count).toBe(2);
    expect(Number(r.total)).toBe(300);
    expect(r.itens.map((d) => d.description)).toEqual(["Vencida", "Amanhã"]);
  });

  it("soma despesas e higienização numa visão só", async () => {
    await criar({ description: "Vencida", amount: 100, dueDate: ontem });
    await criar({ description: "A vencer", amount: 200, dueDate: amanha });
    await prisma.crateCleaning.create({
      data: {
        tenantId,
        cleanerName: "Lava Tudo",
        sentDate: startOfDayTz(HOJE),
        sentQty: 10,
        unitPrice: 5,
        totalAmount: 50,
        status: "DEVOLVIDO",
      },
    });

    const contas = await ContasPagarService.get(tenantId, ["higienizacao"], HOJE);
    const chaves = contas.origens.map((o) => o.chave);
    expect(chaves).toContain("despesas_vencidas");
    expect(chaves).toContain("despesas");
    expect(chaves).toContain("higienizacao");
    expect(Number(contas.total)).toBe(350);
    expect(contas.origens.find((o) => o.chave === "despesas_vencidas")?.urgente).toBe(true);
  });

  it("higienização fora do plano não aparece — o link levaria a uma tela bloqueada", async () => {
    await prisma.crateCleaning.create({
      data: {
        tenantId,
        cleanerName: "Lava Tudo",
        sentDate: startOfDayTz(HOJE),
        sentQty: 10,
        unitPrice: 5,
        totalAmount: 50,
        status: "DEVOLVIDO",
      },
    });
    const contas = await ContasPagarService.get(tenantId, ["caixas"], HOJE);
    expect(contas.origens.map((o) => o.chave)).not.toContain("higienizacao");
  });
});

describe("Categorias", () => {
  beforeEach(async () => {
    await prisma.expenseCategory.deleteMany({ where: { tenantId } });
  });

  it("cria, renomeia e recusa nome duplicado", async () => {
    const c = await DespesasService.createCategory({ name: "Frete" }, ctx);
    expect(c.isDefault).toBe(false);

    await expect(DespesasService.createCategory({ name: "Frete" }, ctx)).rejects.toThrow(
      /já existe/i,
    );

    const r = await DespesasService.renameCategory({ id: c.id, name: "Frete e pedágio" }, ctx);
    expect(r.name).toBe("Frete e pedágio");
  });

  it("renomear vale para as padrão, excluir não", async () => {
    await createDefaultExpenseCategories(tenantId);
    const padrao = (await DespesasService.listCategories(tenantId)).find((c) => c.isDefault)!;

    const r = await DespesasService.renameCategory(
      { id: padrao.id, name: "Retirada do dono" },
      ctx,
    );
    expect(r.name).toBe("Retirada do dono");

    await expect(DespesasService.removeCategory(padrao.id, ctx)).rejects.toThrow(/padrão/i);
  });

  it("categoria em uso não é excluída — o histórico perderia a classificação", async () => {
    const c = await DespesasService.createCategory({ name: "Gás" }, ctx);
    await criar({ categoryId: c.id });

    await expect(DespesasService.removeCategory(c.id, ctx)).rejects.toThrow(/está em 1 despesa/i);

    await prisma.expense.deleteMany({ where: { tenantId } });
    await expect(DespesasService.removeCategory(c.id, ctx)).resolves.toBeUndefined();
  });

  it("conta quantas despesas usam cada categoria", async () => {
    const c = await DespesasService.createCategory({ name: "Gás" }, ctx);
    await criar({ categoryId: c.id });
    await criar({ categoryId: c.id });

    const comUso = await DespesasService.listCategoriesComUso(tenantId);
    expect(comUso.find((x) => x.id === c.id)?.despesas).toBe(2);
  });
});

describe("Frete da compra como despesa", () => {
  it("cria uma conta a pagar e não duplica na segunda chamada", async () => {
    const purchase = await prisma.purchase.create({
      data: {
        tenantId,
        purchaseDate: startOfDayTz(HOJE),
        freight: 180,
        totalAmount: 1180,
      },
    });

    const e = await DespesasService.lancarFreteDaCompra(
      {
        purchaseId: purchase.id,
        amount: purchase.freight,
        purchaseDate: purchase.purchaseDate,
        supplierName: "Transportes Silva",
      },
      ctx,
    );
    expect(e).not.toBeNull();
    expect(e!.description).toContain("Transportes Silva");
    expect(e!.type).toBe("VARIAVEL");
    expect(e!.status).toBe("PENDENTE");
    expect(Number(e!.amount)).toBe(180);

    const repetido = await DespesasService.lancarFreteDaCompra(
      { purchaseId: purchase.id, amount: 180, purchaseDate: purchase.purchaseDate },
      ctx,
    );
    expect(repetido).toBeNull();
    expect(await prisma.expense.count({ where: { tenantId, purchaseId: purchase.id } })).toBe(1);

    await prisma.expense.deleteMany({ where: { tenantId } });
    await prisma.purchase.deleteMany({ where: { tenantId } });
  });

  it("frete zero não gera despesa", async () => {
    const r = await DespesasService.lancarFreteDaCompra(
      { purchaseId: "qualquer", amount: 0, purchaseDate: HOJE },
      ctx,
    );
    expect(r).toBeNull();
  });
});
