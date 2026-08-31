import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { DespesasService, DESPESAS_POR_PAGINA } from "@/lib/services/despesas.service";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Paginação e totais da tela de despesas.
 *
 * A tela carregava TODAS as despesas da empresa para filtrar, ordenar e somar em
 * JavaScript. Medido com 8.000 despesas (≈2 anos de operação) isso levava ~278 ms
 * e crescia sem teto. Agora filtro, ordem, limite e soma são do banco: ~4 ms, e
 * constante.
 *
 * O que estes testes protegem é o que tinha risco de regressão no caminho:
 *  - os totais precisam continuar somando TUDO (os cards são o retrato do total
 *    devido, não da página nem do filtro);
 *  - a página precisa ser realmente limitada;
 *  - a ordem precisa ser a mesma que a tela produzia em JS.
 */

const tenants: string[] = [];
let tenantId = "";

/** 250 despesas: mais de duas páginas, para a paginação ter o que provar. */
const TOTAL = 250;

beforeAll(async () => {
  tenantId = await createTestTenant("DESPESAS PAGINACAO");
  tenants.push(tenantId);

  const base = new Date("2026-01-01T12:00:00Z");
  await prisma.expense.createMany({
    data: Array.from({ length: TOTAL }, (_, i) => ({
      tenantId,
      description: `Despesa ${String(i).padStart(3, "0")}`,
      amount: 10 + i, // soma conhecida: 10..259
      type: i % 2 === 0 ? ("FIXA" as const) : ("VARIAVEL" as const),
      status: i % 5 === 0 ? ("PAGO" as const) : ("PENDENTE" as const),
      // Sem vencimento é o caso que precisa ir para o FIM da lista. O divisor 7 é
      // primo em relação ao 5 do status de propósito: com `i % 10` toda despesa
      // sem data também caía em PAGO, e não sobrava nenhuma PENDENTE sem data —
      // o teste de ordem passava por vacuidade.
      dueDate: i % 7 === 0 ? null : new Date(base.getTime() + i * 864e5),
    })),
  });
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

describe("Totais das despesas", () => {
  it("somam TODAS as despesas, independentemente da página", async () => {
    const totais = await DespesasService.totais(tenantId);
    // Σ(10..259) = 250 * (10 + 259) / 2
    const esperado = (TOTAL * (10 + (10 + TOTAL - 1))) / 2;
    expect(Number(totais.geral)).toBe(esperado);
  });

  it("batem com a soma linha por linha (o metodo antigo)", async () => {
    const novo = await DespesasService.totais(tenantId);
    const todas = await prisma.expense.findMany({
      where: { tenantId, deletedAt: null },
      select: { type: true, amount: true },
    });
    const antigo = FinancialCalc.totaisDespesas(
      todas.map((d) => ({ type: d.type, amount: d.amount })),
    );
    expect(novo.fixas.toString()).toBe(antigo.fixas.toString());
    expect(novo.variaveis.toString()).toBe(antigo.variaveis.toString());
    expect(novo.geral.toString()).toBe(antigo.geral.toString());
  });

  it("separam fixas de variaveis", async () => {
    const t = await DespesasService.totais(tenantId);
    expect(t.fixas.plus(t.variaveis).toString()).toBe(t.geral.toString());
    expect(Number(t.fixas)).toBeGreaterThan(0);
    expect(Number(t.variaveis)).toBeGreaterThan(0);
  });

  it("NAO mudam quando o filtro de status muda", async () => {
    // Era o risco central: paginar/filtrar no banco nao pode encolher os cards.
    const t = await DespesasService.totais(tenantId);
    const pendentes = await DespesasService.count(tenantId, { status: "PENDENTE" });
    expect(pendentes).toBeLessThan(TOTAL); // o filtro realmente restringe
    expect(Number(t.geral)).toBe((TOTAL * (10 + (10 + TOTAL - 1))) / 2);
  });
});

describe("Paginacao", () => {
  it("limita a pagina ao tamanho definido", async () => {
    const pagina = await DespesasService.list(tenantId);
    expect(pagina).toHaveLength(DESPESAS_POR_PAGINA);
  });

  it("respeita o skip e nao repete registros entre paginas", async () => {
    const p1 = await DespesasService.list(tenantId, { skip: 0 });
    const p2 = await DespesasService.list(tenantId, { skip: DESPESAS_POR_PAGINA });
    const ids1 = new Set(p1.map((d) => d.id));
    expect(p2.some((d) => ids1.has(d.id))).toBe(false);
  });

  it("count reflete o filtro de status", async () => {
    const [todas, pendentes, pagas] = await Promise.all([
      DespesasService.count(tenantId),
      DespesasService.count(tenantId, { status: "PENDENTE" }),
      DespesasService.count(tenantId, { status: "PAGO" }),
    ]);
    expect(todas).toBe(TOTAL);
    expect(pendentes + pagas).toBe(TOTAL);
  });

  it("a lista filtrada devolve so o status pedido", async () => {
    const pagas = await DespesasService.list(tenantId, { status: "PAGO" });
    expect(pagas.length).toBeGreaterThan(0);
    expect(pagas.every((d) => d.status === "PAGO")).toBe(true);
  });
});

describe("Ordem (a mesma que a tela produzia em JS)", () => {
  it("pendentes: o que vence primeiro no topo", async () => {
    const p = await DespesasService.list(tenantId, { status: "PENDENTE" });
    const comData = p.filter((d) => d.dueDate !== null).map((d) => d.dueDate!.getTime());
    const ordenado = [...comData].sort((a, b) => a - b);
    expect(comData).toEqual(ordenado);
  });

  it("pendentes: sem vencimento vai para o FIM, nao para o topo", async () => {
    // `nulls: "last"` no orderBy. Sem isso o Postgres coloca NULL primeiro em
    // ordem ascendente, e a tela abriria mostrando o que não tem prazo correndo.
    const todasPendentes = await DespesasService.list(tenantId, {
      status: "PENDENTE",
      take: TOTAL,
    });
    const primeiroSemData = todasPendentes.findIndex((d) => d.dueDate === null);
    const ultimoComData = todasPendentes.reduce(
      (acc, d, i) => (d.dueDate !== null ? i : acc),
      -1,
    );
    expect(primeiroSemData).toBeGreaterThan(ultimoComData);
  });

  it("pagas: mais recente primeiro", async () => {
    const p = await DespesasService.list(tenantId, { status: "PAGO", take: TOTAL });
    const comData = p.filter((d) => d.dueDate !== null).map((d) => d.dueDate!.getTime());
    const ordenado = [...comData].sort((a, b) => b - a);
    expect(comData).toEqual(ordenado);
  });
});
