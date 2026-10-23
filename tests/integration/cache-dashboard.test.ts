import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { DashboardService } from "@/lib/services/dashboard.service";
import { DespesasService } from "@/lib/services/despesas.service";
import { clienteEmMemoria, definirClienteDeCache } from "@/lib/cache/cliente";
import { invalidarTenant } from "@/lib/cache/cache";
import { isoDateTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * O resumo do Início no cache, contra o banco de verdade.
 *
 * A escrita que passa pelo wrapper troca a versão da empresa (`invalidarTenant`,
 * coberto em `tests/unit/cache-wrappers.test.ts`); aqui ela é chamada à mão,
 * como o wrapper faria depois do service.
 */

const tenants: string[] = [];
let a = "";
let b = "";

beforeAll(async () => {
  a = await createTestTenant("CACHE A");
  b = await createTestTenant("CACHE B");
  tenants.push(a, b);
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

afterEach(() => definirClienteDeCache(undefined));

const contaFixa = (descricao: string, valor: number) => ({
  description: descricao,
  amount: valor,
  type: "FIXA" as const,
  status: "PENDENTE" as const,
  dueDate: isoDateTz(),
});

describe("getSummary com cache", () => {
  it("a escrita da empresa aparece na leitura seguinte; a outra empresa não muda", async () => {
    definirClienteDeCache(clienteEmMemoria());

    const antesA = await DashboardService.getSummary(a, undefined, "financeiro");
    const antesB = await DashboardService.getSummary(b, undefined, "financeiro");

    await DespesasService.create(contaFixa("Aluguel", 500), makeCtx(a));
    await invalidarTenant(a);

    const depoisA = await DashboardService.getSummary(a, undefined, "financeiro");
    const depoisB = await DashboardService.getSummary(b, undefined, "financeiro");

    expect(depoisA.despesasFixasMes.minus(antesA.despesasFixasMes).toString()).toBe("500");
    expect(depoisB.despesasFixasMes.toString()).toBe(antesB.despesasFixasMes.toString());
  });

  it("o valor do cache é igual ao calculado, com Decimal de volta", async () => {
    definirClienteDeCache(clienteEmMemoria());
    await DashboardService.getSummary(a, undefined, "geral");
    const doCache = await DashboardService.getSummary(a, undefined, "geral");
    const doBanco = await DashboardService.calcularSummary(a, undefined, "geral");
    expect(doCache.lucroMes.toString()).toBe(doBanco.lucroMes.toString());
    expect(doCache.despesasLucroMes.plus(0).toString()).toBe(doBanco.despesasLucroMes.toString());
    expect(doCache.chart).toEqual(doBanco.chart);
  });

  it("sem invalidar, a leitura repetida não vai ao banco: o número fica o mesmo", async () => {
    definirClienteDeCache(clienteEmMemoria());
    const primeira = await DashboardService.getSummary(b, undefined, "financeiro");
    await DespesasService.create(contaFixa("Luz", 90), makeCtx(b));
    const semInvalidar = await DashboardService.getSummary(b, undefined, "financeiro");
    expect(semInvalidar.despesasFixasMes.toString()).toBe(primeira.despesasFixasMes.toString());
    await invalidarTenant(b);
    const depois = await DashboardService.getSummary(b, undefined, "financeiro");
    expect(depois.despesasFixasMes.minus(primeira.despesasFixasMes).toString()).toBe("90");
  });
});
