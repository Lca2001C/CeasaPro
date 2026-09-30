import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { caixaMovimentoSchema } from "@/lib/validations/caixa";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * O lote de higienização e o pote "com o higienizador" andando juntos.
 *
 * Cada `describe` usa uma empresa própria: o pote é da EMPRESA, e os cenários
 * dependem de saber exatamente quantas caixas há nele.
 */
const tenants: string[] = [];
const hoje = () => new Date().toISOString();

afterAll(async () => {
  await cleanupTenants(tenants);
});

async function novaEmpresa(nome: string): Promise<{ tenantId: string; ctx: TenantCtx }> {
  const tenantId = await createTestTenant(nome);
  tenants.push(tenantId);
  return { tenantId, ctx: makeCtx(tenantId) };
}

async function entrarSujas(ctx: TenantCtx, qtd: number) {
  await CaixasService.registrar(
    { type: "ENTRADA", quantity: qtd, dirty: true, movementDate: hoje() },
    ctx,
  );
}

function enviar(ctx: TenantCtx, qtd: number, cleanerName = "João") {
  return HigienizacaoService.create(
    { cleanerName, sentDate: hoje(), sentQty: qtd, unitPrice: 1, notes: null },
    ctx,
  );
}

/**
 * #28 — movimento de higienizador lançado fora do lote.
 *
 * "Registrar perda" oferecia o campo Higienizador, e "Outro" oferecia
 * "Voltou da higienização". Os dois mexiam no pote sem o lote saber: o lote
 * continuava cobrando as caixas, e a perda/devolução pelo próprio lote passava
 * a ser recusada ("Há 0 caixa(s) no higienizador"). Lote ENVIADO para sempre.
 */
describe("Movimento de higienizador só entra pelo lote", () => {
  it("o schema do formulário manual recusa tipos de higienizador e o nome do higienizador", () => {
    const base = { quantity: 3, movementDate: "2026-09-30" };
    expect(caixaMovimentoSchema.safeParse({ ...base, type: "SAIDA_HIGIENIZACAO", cleanerName: "João" }).success).toBe(false);
    expect(caixaMovimentoSchema.safeParse({ ...base, type: "RETORNO_HIGIENIZACAO", cleanerName: "João" }).success).toBe(false);
    expect(caixaMovimentoSchema.safeParse({ ...base, type: "ESTORNO_SAIDA" }).success).toBe(false);
    expect(caixaMovimentoSchema.safeParse({ ...base, type: "QUEBRA", cleanerName: "João" }).success).toBe(false);
    expect(caixaMovimentoSchema.safeParse({ ...base, type: "QUEBRA" }).success).toBe(true);
  });

  it("o serviço recusa QUEBRA/RETORNO de higienizador sem vínculo, e o lote fecha", async () => {
    const { tenantId, ctx } = await novaEmpresa("HIG VINCULO");
    await entrarSujas(ctx, 50);
    const lote = await enviar(ctx, 50);

    await expect(
      CaixasService.registrar(
        { type: "QUEBRA", quantity: 3, cleanerName: "João", movementDate: hoje() },
        ctx,
      ),
    ).rejects.toThrow(/Higienização/);
    await expect(
      CaixasService.registrar(
        { type: "RETORNO_HIGIENIZACAO", quantity: 50, cleanerName: "João", movementDate: hoje() },
        ctx,
      ),
    ).rejects.toThrow(/Higienização/);
    expect((await CaixasService.getSaldo(tenantId)).emHigienizacao).toBe(50);

    // O caminho certo: pelo lote. Ele fecha.
    await HigienizacaoService.registrarPerda({ id: lote.id, quantity: 3, movementDate: hoje() }, ctx);
    const fechado = await HigienizacaoService.registrarDevolucao(
      { id: lote.id, quantity: 47, returnedDate: hoje() },
      ctx,
    );
    expect(fechado.status).toBe("DEVOLVIDO");
    expect((await CaixasService.getSaldo(tenantId)).emHigienizacao).toBe(0);
  });
});

/**
 * #29 — reduzir ou excluir o envio quando as caixas já saíram do pote por
 * outro caminho (movimento solto gravado antes da trava acima: dado legado).
 */
describe("Reduzir/excluir envio confere o pote do higienizador", () => {
  it("recusa em vez de deixar 'Em higienização' negativo e sujas fantasma", async () => {
    const { tenantId, ctx } = await novaEmpresa("HIG REDUZIR");
    await entrarSujas(ctx, 50);
    const lote = await enviar(ctx, 50);
    // Legado: "Voltou da higienização" lançado à mão, sem vínculo com o lote.
    await prisma.plasticCrateMovement.create({
      data: {
        tenantId,
        type: "RETORNO_HIGIENIZACAO",
        quantity: 50,
        cleanerName: "João",
        movementDate: new Date(),
      },
    });
    const antes = await CaixasService.getSaldo(tenantId);
    expect(antes.emHigienizacao).toBe(0);

    await expect(
      HigienizacaoService.update(
        { id: lote.id, cleanerName: "João", sentDate: hoje(), sentQty: 10, unitPrice: 1 },
        ctx,
      ),
    ).rejects.toThrow(/higienizador/);
    await expect(HigienizacaoService.remove(lote.id, ctx)).rejects.toThrow(/higienizador/);

    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.emHigienizacao).toBe(0);
    expect(depois.sujas).toBe(antes.sujas);
  });

  it("sem movimento solto, reduzir e excluir continuam funcionando", async () => {
    const { tenantId, ctx } = await novaEmpresa("HIG REDUZIR OK");
    await entrarSujas(ctx, 50);
    const lote = await enviar(ctx, 50);
    await HigienizacaoService.update(
      { id: lote.id, cleanerName: "João", sentDate: hoje(), sentQty: 40, unitPrice: 1 },
      ctx,
    );
    expect(await CaixasService.getSaldo(tenantId)).toMatchObject({ emHigienizacao: 40, sujas: 10 });
    await HigienizacaoService.remove(lote.id, ctx);
    expect(await CaixasService.getSaldo(tenantId)).toMatchObject({ emHigienizacao: 0, sujas: 50 });
  });
});

/**
 * #30 — as pendências do lote eram lidas ANTES do lock (que só vinha dentro
 * de `registrarInTx`). Com outro lote do mesmo higienizador cobrindo o pote,
 * a guarda global não pegava: o lote A resolvia 6 de 3, e o lote B perdia 3
 * caixas do pote e não conseguia mais devolver as suas.
 */
/**
 * Segura o lock de caixas da empresa numa terceira transação enquanto as
 * operações começam, e só então solta.
 *
 * Sem isto a corrida quase nunca aparece: cada transação é rápida e a primeira
 * termina antes de a segunda ler. Com o lock preso, as duas chegam juntas ao
 * ponto em que o código decide — que é exatamente o que duas abas ou um toque
 * duplo fazem em produção. Se a leitura das pendências vem ANTES do lock, as
 * duas leem "pendentes = 3" enquanto esperam; se vem depois, a segunda lê o
 * que a primeira gravou.
 */
async function comLockPreso<T>(tenantId: string, operacoes: () => Promise<T>): Promise<T> {
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  let preso!: () => void;
  const travado = new Promise<void>((r) => (preso = r));
  const segurador = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 1)`;
      preso();
      await solto;
    },
    { timeout: 20_000 },
  );
  await travado;
  const resultado = operacoes();
  await new Promise((r) => setTimeout(r, 700));
  soltar();
  await segurador;
  return resultado;
}

describe("Perda simultânea no mesmo lote", () => {
  it("duas perdas das mesmas 3 caixas: só uma passa, e o outro lote segue devolvendo", async () => {
    const { tenantId, ctx } = await novaEmpresa("HIG PERDA DUPLA");
    await entrarSujas(ctx, 43);
    const a = await enviar(ctx, 3);
    const b = await enviar(ctx, 40);

    const tentativas = await comLockPreso(tenantId, () =>
      Promise.allSettled(
        Array.from({ length: 2 }, () =>
          HigienizacaoService.registrarPerda({ id: a.id, quantity: 3, movementDate: hoje() }, ctx),
        ),
      ),
    );
    expect(tentativas.filter((t) => t.status === "fulfilled")).toHaveLength(1);

    const perdasA = await prisma.plasticCrateMovement.aggregate({
      where: { crateCleaningId: a.id, type: "QUEBRA" },
      _sum: { quantity: true },
    });
    expect(perdasA._sum.quantity).toBe(3);
    expect((await CaixasService.getSaldo(tenantId)).emHigienizacao).toBe(40);

    const devolvidoB = await HigienizacaoService.registrarDevolucao(
      { id: b.id, quantity: 40, returnedDate: hoje() },
      ctx,
    );
    expect(devolvidoB.returnedQty).toBe(40);
  });

  it("perda e devolução das mesmas 3 caixas ao mesmo tempo: o lote não resolve mais do que saiu", async () => {
    const { tenantId, ctx } = await novaEmpresa("HIG PERDA DEVOLUCAO");
    await entrarSujas(ctx, 43);
    const a = await enviar(ctx, 3);
    await enviar(ctx, 40);

    await comLockPreso(tenantId, () =>
      Promise.allSettled([
        HigienizacaoService.registrarPerda({ id: a.id, quantity: 3, movementDate: hoje() }, ctx),
        HigienizacaoService.registrarDevolucao(
          { id: a.id, quantity: 3, returnedDate: hoje() },
          ctx,
        ),
      ]),
    );

    const lote = await HigienizacaoService.get(tenantId, a.id);
    expect(lote.returnedQty + lote.perdidas).toBe(3);
    expect((await CaixasService.getSaldo(tenantId)).emHigienizacao).toBe(40);
  });
});

/**
 * #33 — os totais saíam dos 500 envios mais recentes: um lote antigo pendente
 * além do 500º sumia de "Caixas a receber" e "Total a pagar".
 */
describe("Totais da higienização", () => {
  it("contam o lote pendente antigo mesmo com mais de 500 envios mais novos", async () => {
    const { tenantId, ctx } = await novaEmpresa("HIG TOTAIS");
    await entrarSujas(ctx, 5);
    await HigienizacaoService.create(
      { cleanerName: "Antigo", sentDate: "2024-01-10", sentQty: 5, unitPrice: 2, notes: null },
      ctx,
    );
    // 501 lotes encerrados, todos mais novos que o pendente.
    await prisma.crateCleaning.createMany({
      data: Array.from({ length: 501 }, () => ({
        tenantId,
        cleanerName: "Recente",
        sentDate: new Date(),
        sentQty: 1,
        unitPrice: 1,
        totalAmount: 1,
        returnedQty: 1,
        paidAmount: 1,
        status: "PAGO" as const,
      })),
    });

    const r = await HigienizacaoService.list(tenantId);
    expect(r.caixasAReceber).toBe(5);
    expect(Number(r.totalAPagar)).toBe(10);
    expect(r.aguardandoDevolucao).toBe(1);
    expect(r.aguardandoPagamento).toBe(1);
    expect(r.registros.length).toBeLessThanOrEqual(100);

    const soPagos = await HigienizacaoService.list(tenantId, "PAGO");
    expect(soPagos.registros.every((c) => c.status === "PAGO")).toBe(true);
    expect(soPagos.caixasAReceber).toBe(5); // filtro muda a lista, não os totais
  });
});
