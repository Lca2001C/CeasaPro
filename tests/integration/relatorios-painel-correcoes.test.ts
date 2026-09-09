import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { buildReport } from "@/lib/reports/report.service";
import { DashboardService } from "@/lib/services/dashboard.service";
import { DespesasService } from "@/lib/services/despesas.service";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { resolvePeriod } from "@/lib/dates";
import { isoDateTz, addDaysTz, startOfMonthTz, startOfNextMonthTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Relatórios e painel que davam números diferentes da tela — ou de si mesmos.
 */

const tenants: string[] = [];
let tenantId = "";
let ctx = makeCtx("");
const hoje = isoDateTz();

beforeAll(async () => {
  tenantId = await createTestTenant("RELATORIOS");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

beforeEach(async () => {
  await prisma.plasticCrateMovement.deleteMany({ where: { tenantId } });
  await prisma.crateCleaningPayment.deleteMany({ where: { tenantId } });
  await prisma.crateCleaning.deleteMany({ where: { tenantId } });
  await prisma.creditAccount.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
});

const periodoDoMes = () => resolvePeriod({ preset: "mes" });

describe("relatório de higienização conta as caixas PERDIDAS (regressão)", () => {
  it("bate com o que a tela mostra", async () => {
    await CaixasService.registrar(
      { type: "ENTRADA", quantity: 60, dirty: true, supplierName: "Ceasa", movementDate: hoje },
      ctx,
    );
    const lote = await HigienizacaoService.create(
      { cleanerName: "Lava Bem", sentDate: hoje, sentQty: 50, unitPrice: 1 },
      ctx,
    );
    await HigienizacaoService.registrarDevolucao(
      { id: lote.id, quantity: 47, returnedDate: hoje },
      ctx,
    );
    await HigienizacaoService.registrarPerda(
      { id: lote.id, quantity: 3, movementDate: hoje },
      ctx,
    );

    // A TELA usa `sentQty − returnedQty − perdidas` e diz "0 a receber".
    const daTela = await HigienizacaoService.get(tenantId, lote.id);
    expect(daTela!.caixasAReceber).toBe(0);

    // O RELATÓRIO fazia `sentQty − returnedQty` e dizia "3 a receber" — e era
    // esse número que ia cobrar do higienizador caixa que ele já pagou.
    const p = periodoDoMes();
    const rel = await buildReport("HIGIENIZACAO", { tenantId, from: p.from, to: p.to });
    const linha = rel.rows[0] as Record<string, number>;
    expect(linha.perdidas).toBe(3);
    expect(linha.aReceber).toBe(0);
    expect(rel.totals!.aReceber).toBe(0);
  });
});

describe("relatório de inadimplentes (regressão)", () => {
  async function conta(patch: { dueDate?: Date | null; createdAt?: Date }) {
    return prisma.creditAccount.create({
      data: {
        tenantId,
        customerName: `Cliente ${Math.random().toString(36).slice(2, 7)}`,
        totalAmount: 100,
        paidAmount: 0,
        status: "EM_ABERTO",
        dueDate: patch.dueDate ?? null,
        ...(patch.createdAt ? { createdAt: patch.createdAt } : {}),
      },
    });
  }

  // No Prisma, `dueDate: { lt: ... }` EXCLUI NULL — e a maioria das contas
  // fiadas nasce sem vencimento, porque o PDV só o envia quando há parte fiada
  // E o operador digita a data. O relatório de inadimplentes não mostrava a
  // maior parte dos inadimplentes, apesar de o comentário prometer
  // "(ou sem vencimento e antigo)".
  it("inclui conta antiga SEM data de vencimento", async () => {
    await conta({ dueDate: null, createdAt: addDaysTz(new Date(), -45) });
    const p = periodoDoMes();
    const rel = await buildReport("INADIMPLENTES", {
      tenantId,
      from: addDaysTz(p.from, -60),
      to: p.to,
    });
    expect(rel.rows).toHaveLength(1);
  });

  it("não inclui conta recente sem vencimento — ainda não é inadimplência", async () => {
    await conta({ dueDate: null, createdAt: addDaysTz(new Date(), -3) });
    const p = periodoDoMes();
    const rel = await buildReport("INADIMPLENTES", { tenantId, from: p.from, to: p.to });
    expect(rel.rows).toHaveLength(0);
  });

  it("conta que vence HOJE não é atrasada", async () => {
    // Usava `new Date()` em vez do início do dia no fuso: quem vence hoje
    // aparecia como atrasado durante todo o dia. A tela do fiado usa
    // `startOfDayTz` — as duas discordavam.
    await conta({ dueDate: new Date() });
    const p = periodoDoMes();
    const rel = await buildReport("INADIMPLENTES", { tenantId, from: p.from, to: p.to });
    expect(rel.rows).toHaveLength(0);
  });

  it("respeita o período do cabeçalho", async () => {
    // `p.from`/`p.to` eram ignorados: o cabeçalho dizia "Período: 01/09 a
    // 30/09" e o conteúdo era o histórico inteiro.
    await conta({ dueDate: addDaysTz(new Date(), -200), createdAt: addDaysTz(new Date(), -200) });
    const p = periodoDoMes();
    const noMes = await buildReport("INADIMPLENTES", { tenantId, from: p.from, to: p.to });
    expect(noMes.rows).toHaveLength(0);

    const amplo = await buildReport("INADIMPLENTES", {
      tenantId,
      from: addDaysTz(new Date(), -365),
      to: p.to,
    });
    expect(amplo.rows).toHaveLength(1);
  });
});

describe("painel: agregações do mês têm TETO (regressão)", () => {
  it("parcela recorrente de mês futuro não derruba o lucro do mês", async () => {
    const cat = await DespesasService.createCategory({ name: `Aluguel ${Date.now()}` }, ctx);
    const proximoMes = startOfMonthTz(addDaysTz(startOfMonthTz(new Date()), 40));

    // Despesa DESTE mês.
    await prisma.expense.create({
      data: {
        tenantId,
        categoryId: cat.id,
        description: "Aluguel do mês",
        type: "FIXA",
        amount: 500,
        status: "PENDENTE",
        dueDate: new Date(),
      },
    });
    // A parcela do mês SEGUINTE, como `gerarProximaParcela` cria ao quitar.
    await prisma.expense.create({
      data: {
        tenantId,
        categoryId: cat.id,
        description: "Aluguel do mês seguinte",
        type: "FIXA",
        amount: 500,
        status: "PENDENTE",
        dueDate: proximoMes,
      },
    });

    const painel = await DashboardService.getSummary(tenantId);
    // Sem teto, `COALESCE("dueDate","createdAt") >= monthStart` somava as duas:
    // com dez contas fixas de R$ 500, o lucro do mês vinha R$ 5.000 abaixo.
    expect(Number(painel.despesasFixasMes)).toBe(500);

    // E passa a fechar com `resumoMes`, que sempre usou {gte, lte}.
    const resumo = await DespesasService.resumoMes(tenantId);
    expect(Number(painel.despesasFixasMes)).toBe(Number(resumo.fixas));
  });

  /**
   * O teto do mês é o FIM DO MÊS, não "até agora".
   *
   * A conta fixa que vence dia 20 é despesa deste mês desde o dia 1º. Com o
   * teto em "hoje", no dia 8 o painel dizia "Contas fixas R$ 0,00" e um
   * "Sobrou no mês" inflado, enquanto /despesas mostrava o valor cheio no
   * mesmo instante — e o lucro ia "piorando" conforme os vencimentos chegavam,
   * sem nada ter acontecido.
   *
   * No último dia do mês não existe "mais adiante no mês", então nesse dia o
   * caso é degenerado: o teste continua passando, só não exercita a borda.
   */
  it("conta que vence mais adiante NESTE mês já entra no mês", async () => {
    const cat = await DespesasService.createCategory({ name: `Luz ${Date.now()}` }, ctx);
    const fimDoMes = new Date(startOfNextMonthTz(new Date()).getTime() - 1);

    await prisma.expense.create({
      data: {
        tenantId,
        categoryId: cat.id,
        description: "Luz a vencer",
        type: "VARIAVEL",
        amount: 300,
        status: "PENDENTE",
        dueDate: fimDoMes,
      },
    });

    const painel = await DashboardService.getSummary(tenantId);
    const resumo = await DespesasService.resumoMes(tenantId);

    // O painel não pode discordar da tela de Despesas sobre o mesmo mês.
    expect(Number(painel.despesasVariaveisMes)).toBe(Number(resumo.variaveis));
    expect(Number(painel.despesasVariaveisMes)).toBeGreaterThanOrEqual(300);
  });

  it("'Contas do mês — A pagar' é do MÊS, não o pendente de toda a história", async () => {
    const cat = await DespesasService.createCategory({ name: `Atraso ${Date.now()}` }, ctx);
    // Conta atrasada de um mês anterior e parcela de um mês futuro: nenhuma
    // das duas é "conta do mês", e as duas entravam no card.
    await prisma.expense.create({
      data: {
        tenantId,
        categoryId: cat.id,
        description: "Atrasada de outro mês",
        type: "VARIAVEL",
        amount: 777,
        status: "PENDENTE",
        dueDate: addDaysTz(startOfMonthTz(new Date()), -20),
      },
    });
    await prisma.expense.create({
      data: {
        tenantId,
        categoryId: cat.id,
        description: "Parcela de mês futuro",
        type: "VARIAVEL",
        amount: 888,
        status: "PENDENTE",
        dueDate: startOfMonthTz(addDaysTz(startOfMonthTz(new Date()), 40)),
      },
    });

    const painel = await DashboardService.getSummary(tenantId);
    const resumo = await DespesasService.resumoMes(tenantId);
    expect(Number(painel.contasPagar)).toBe(Number(resumo.aPagar));
  });

  it("frete com purchaseId não entra no lucro — já está no CMV", async () => {
    const purchase = await prisma.purchase.create({
      data: {
        tenantId,
        purchaseDate: new Date(),
        freight: 180,
        totalAmount: 1180,
      },
    });
    const cat = await DespesasService.createCategory({ name: `Op ${Date.now()}` }, ctx);
    await prisma.expense.create({
      data: {
        tenantId,
        categoryId: cat.id,
        description: "Internet",
        type: "VARIAVEL",
        amount: 100,
        status: "PENDENTE",
        dueDate: new Date(),
      },
    });
    await prisma.expense.create({
      data: {
        tenantId,
        categoryId: cat.id,
        description: "Frete da compra",
        type: "VARIAVEL",
        amount: 180,
        status: "PENDENTE",
        dueDate: new Date(),
        purchaseId: purchase.id,
      },
    });

    const painel = await DashboardService.getSummary(tenantId);
    // Sem vendas/CMV, lucro = 0 - despesas operacionais. O frete (180) fica de fora.
    expect(Number(painel.lucroMes)).toBe(-100);

    await prisma.expense.deleteMany({ where: { tenantId } });
    await prisma.purchase.deleteMany({ where: { tenantId } });
  });
});

describe("reduzir o envio de higienizacao NAO lava caixa (regressao)", () => {
  it("as caixas voltam para SUJAS, nao para limpas", async () => {
    await CaixasService.registrar(
      { type: "ENTRADA", quantity: 60, dirty: true, supplierName: "Ceasa", movementDate: hoje },
      ctx,
    );
    const antes = await CaixasService.getSaldo(tenantId);
    expect(antes.sujas).toBe(60);

    const lote = await HigienizacaoService.create(
      { cleanerName: "Lava Bem", sentDate: hoje, sentQty: 50, unitPrice: 1 },
      ctx,
    );
    const enviado = await CaixasService.getSaldo(tenantId);
    expect(enviado.emHigienizacao).toBe(50);
    expect(enviado.sujas).toBe(10);

    // Percebe que eram 40, nao 50, e corrige.
    await HigienizacaoService.update(
      { id: lote.id, cleanerName: "Lava Bem", sentDate: hoje, sentQty: 40, unitPrice: 1 },
      ctx,
    );

    // Compensar com RETORNO_HIGIENIZACAO fazia as 10 virarem LIMPAS sem terem
    // sido lavadas — `resolveDirty` mapeia esse tipo para dirty:false.
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.emHigienizacao).toBe(40);
    expect(depois.sujas).toBe(20);
    expect(depois.limpas).toBe(0);
  });
});

/**
 * Fluxo de caixa: a saída é o que saiu NAQUELE dia.
 *
 * `crate_cleanings.paidAmount` é acumulado e `paidDate` guarda só a data do
 * ÚLTIMO pagamento, e o relatório somava esses dois campos. Pagamento
 * parcelado ao higienizador jogava o valor cheio do lote no dia do último,
 * deixava o dia do primeiro sem despesa nenhuma e, se o último caía fora do
 * período, sumia com o lote inteiro — o mês fechava com saída menor que a
 * real, e é o número que vai para o contador.
 */
describe("fluxo de caixa com pagamento parcelado ao higienizador", () => {
  // Deslocamento a partir de HOJE, não dia do mês: com dia fixo o teste
  // reprovaria nos primeiros dias do mês, quando a janela do preset "mes"
  // (que termina agora) não alcança o dia 5.
  const dia = (offset: number) => isoDateTz(addDaysTz(new Date(), offset));

  async function loteComDoisPagamentos() {
    await CaixasService.registrar(
      { type: "ENTRADA", quantity: 20, dirty: true, movementDate: hoje },
      ctx,
    );
    const lote = await HigienizacaoService.create(
      {
        cleanerName: `Silva-${Date.now()}`,
        sentDate: dia(-6),
        sentQty: 20,
        unitPrice: 2,
        notes: null,
      },
      ctx,
    );
    // Total 40: paga 10 há 5 dias e 30 ontem.
    await HigienizacaoService.registrarPagamento(
      { id: lote.id, amount: 10, paidDate: dia(-5) },
      ctx,
    );
    await HigienizacaoService.registrarPagamento(
      { id: lote.id, amount: 30, paidDate: dia(-1) },
      ctx,
    );
    return lote;
  }

  it("cada parcela entra no SEU dia, não tudo no dia do último pagamento", async () => {
    await loteComDoisPagamentos();
    const p = resolvePeriod({ preset: "personalizado", from: dia(-6), to: dia(0) });
    const rel = await buildReport("FLUXO_CAIXA", { tenantId, from: p.from, to: p.to });

    const saidaEm = (offset: number) => {
      const alvo = dia(offset);
      const linha = rel.rows.find((r) => isoDateTz(r.date as Date) === alvo);
      return Number((linha?.saidas as { toString(): string } | undefined)?.toString() ?? 0);
    };

    expect(saidaEm(-5)).toBe(10);
    expect(saidaEm(-1)).toBe(30);
  });

  it("período que termina antes do último pagamento ainda mostra o primeiro", async () => {
    await loteComDoisPagamentos();
    // Janela que termina ANTES do último pagamento.
    const p = resolvePeriod({ preset: "personalizado", from: dia(-6), to: dia(-3) });
    const rel = await buildReport("FLUXO_CAIXA", { tenantId, from: p.from, to: p.to });

    // Antes o lote inteiro desaparecia: `paidDate` (o último pagamento) ficava
    // fora da janela, e com ele os R$ 10 que saíram de verdade há 5 dias.
    const total = rel.rows.reduce(
      (a, r) => a + Number((r.saidas as { toString(): string }).toString()),
      0,
    );
    expect(total).toBe(10);
  });
});
