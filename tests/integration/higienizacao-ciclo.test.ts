import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Ciclo completo da higienização: envio → devolução → pagamento, com as saídas
 * pelas bordas (perda no higienizador, exclusão de envio lançado por engano).
 *
 * O saldo de caixas é derivado do livro-razão, então cada etapa é verificada
 * pelos DOIS lados: o registro do lote e o saldo real de caixas.
 */
const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
let tenantId = "";
let ctx: TenantCtx;

const hoje = () => new Date().toISOString();

/** Coloca N caixas sujas no estoque, que é de onde o envio tira. */
async function entrarSujas(qtd: number) {
  await CaixasService.registrar(
    { type: "ENTRADA", quantity: qtd, dirty: true, movementDate: hoje() },
    ctx,
  );
}

async function enviar(qtd: number, unitPrice = 1) {
  return HigienizacaoService.create(
    { cleanerName: `Silva-${uniq()}`, sentDate: hoje(), sentQty: qtd, unitPrice, notes: null },
    ctx,
  );
}

beforeAll(async () => {
  tenantId = await createTestTenant("HIGIENIZACAO CICLO");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

describe("Envio", () => {
  it("tira as caixas de sujas e coloca em higienização", async () => {
    await entrarSujas(50);
    const antes = await CaixasService.getSaldo(tenantId);

    const lote = await enviar(50);

    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.sujas).toBe(antes.sujas - 50);
    expect(depois.emHigienizacao).toBe(antes.emHigienizacao + 50);
    expect(lote.status).toBe("ENVIADO");
  });

  it("recusa enviar mais caixas sujas do que existem", async () => {
    const saldo = await CaixasService.getSaldo(tenantId);
    await expect(enviar(saldo.sujas + 100)).rejects.toThrow();
  });
});

describe("Devolução", () => {
  it("devolução parcial mantém o lote ENVIADO e devolve as caixas como LIMPAS", async () => {
    await entrarSujas(30);
    const lote = await enviar(30);
    const antes = await CaixasService.getSaldo(tenantId);

    await HigienizacaoService.registrarDevolucao(
      { id: lote.id, quantity: 10, returnedDate: hoje() },
      ctx,
    );

    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.limpas).toBe(antes.limpas + 10);
    expect(depois.emHigienizacao).toBe(antes.emHigienizacao - 10);

    const atual = await HigienizacaoService.get(tenantId, lote.id);
    expect(atual.status).toBe("ENVIADO");
    expect(atual.caixasAReceber).toBe(20);
  });

  it("devolvendo tudo, o lote vira DEVOLVIDO enquanto houver saldo a pagar", async () => {
    await entrarSujas(20);
    const lote = await enviar(20, 2); // R$ 40 a pagar
    await HigienizacaoService.registrarDevolucao(
      { id: lote.id, quantity: 20, returnedDate: hoje() },
      ctx,
    );

    const atual = await HigienizacaoService.get(tenantId, lote.id);
    expect(atual.status).toBe("DEVOLVIDO");
    expect(atual.caixasAReceber).toBe(0);
    expect(Number(atual.valorAPagar)).toBe(40);
  });

  it("recusa devolver mais do que saiu", async () => {
    await entrarSujas(10);
    const lote = await enviar(10);
    await expect(
      HigienizacaoService.registrarDevolucao(
        { id: lote.id, quantity: 11, returnedDate: hoje() },
        ctx,
      ),
    ).rejects.toThrow(/Faltam apenas 10/);
  });
});

describe("Pagamento", () => {
  it("pagar tudo COM caixa ainda fora NÃO encerra o lote", async () => {
    // Era o bug: `PAGO` era decidido só pelo dinheiro, e o lote sumia das
    // pendências com caixa ainda no higienizador.
    await entrarSujas(25);
    const lote = await enviar(25, 2); // R$ 50
    await HigienizacaoService.registrarDevolucao(
      { id: lote.id, quantity: 5, returnedDate: hoje() },
      ctx,
    );
    await HigienizacaoService.registrarPagamento(
      { id: lote.id, amount: 50, paidDate: hoje() },
      ctx,
    );

    const atual = await HigienizacaoService.get(tenantId, lote.id);
    expect(atual.status).toBe("ENVIADO"); // ainda tem 20 caixas fora
    expect(atual.caixasAReceber).toBe(20);
    expect(Number(atual.valorAPagar)).toBe(0);
  });

  it("lote SEM cobrança não nasce PAGO — só fecha quando as caixas voltam", async () => {
    // `unitPrice` zero (favor, acerto por fora) fazia `totalAmount = 0` e o
    // lote era marcado PAGO na primeira devolução, com caixas ainda fora.
    await entrarSujas(12);
    const lote = await enviar(12, 0);

    await HigienizacaoService.registrarDevolucao(
      { id: lote.id, quantity: 4, returnedDate: hoje() },
      ctx,
    );
    expect((await HigienizacaoService.get(tenantId, lote.id)).status).toBe("ENVIADO");

    await HigienizacaoService.registrarDevolucao(
      { id: lote.id, quantity: 8, returnedDate: hoje() },
      ctx,
    );
    expect((await HigienizacaoService.get(tenantId, lote.id)).status).toBe("PAGO");
  });

  it("recusa pagar acima do saldo devedor", async () => {
    await entrarSujas(5);
    const lote = await enviar(5, 2); // R$ 10
    await expect(
      HigienizacaoService.registrarPagamento({ id: lote.id, amount: 50, paidDate: hoje() }, ctx),
    ).rejects.toThrow(/maior que o saldo/i);
  });
});

describe("Perda no higienizador", () => {
  it("fecha o lote quando a caixa não volta", async () => {
    // Enviou 50, voltaram 47: sem isto o lote ficaria para sempre cobrando
    // uma devolução que não vai acontecer.
    await entrarSujas(50);
    const lote = await enviar(50, 1);
    await HigienizacaoService.registrarDevolucao(
      { id: lote.id, quantity: 47, returnedDate: hoje() },
      ctx,
    );
    expect((await HigienizacaoService.get(tenantId, lote.id)).caixasAReceber).toBe(3);

    const antes = await CaixasService.getSaldo(tenantId);
    await HigienizacaoService.registrarPerda(
      { id: lote.id, quantity: 3, movementDate: hoje() },
      ctx,
    );

    const atual = await HigienizacaoService.get(tenantId, lote.id);
    expect(atual.perdidas).toBe(3);
    expect(atual.caixasAReceber).toBe(0);
    expect(atual.status).toBe("DEVOLVIDO"); // caixas resolvidas, ainda deve R$ 50

    // O saldo de caixas também fecha: saem de "em higienização" e viram perda.
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.emHigienizacao).toBe(antes.emHigienizacao - 3);
    expect(depois.perdidas).toBe(antes.perdidas + 3);
  });

  it("recusa perda maior que o pendente", async () => {
    await entrarSujas(8);
    const lote = await enviar(8);
    await expect(
      HigienizacaoService.registrarPerda({ id: lote.id, quantity: 9, movementDate: hoje() }, ctx),
    ).rejects.toThrow(/Só faltam 8/);
  });

  it("caixa dada como perdida não pode voltar na devolução", async () => {
    await entrarSujas(10);
    const lote = await enviar(10);
    await HigienizacaoService.registrarPerda(
      { id: lote.id, quantity: 4, movementDate: hoje() },
      ctx,
    );
    await expect(
      HigienizacaoService.registrarDevolucao(
        { id: lote.id, quantity: 7, returnedDate: hoje() },
        ctx,
      ),
    ).rejects.toThrow(/Faltam apenas 6/);
  });
});

describe("Exclusão de envio lançado por engano", () => {
  it("devolve as caixas para SUJAS, não para limpas", async () => {
    // Compensar com RETORNO_HIGIENIZACAO colocaria em `limpas` — o sistema
    // estaria "lavando" caixa no papel, sem ninguém ter lavado.
    await entrarSujas(15);
    const antes = await CaixasService.getSaldo(tenantId);
    const lote = await enviar(15);

    await HigienizacaoService.remove(lote.id, ctx);

    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.sujas).toBe(antes.sujas);
    expect(depois.limpas).toBe(antes.limpas);
    expect(depois.emHigienizacao).toBe(antes.emHigienizacao);
  });

  it("não deixa movimento órfão do lote apagado", async () => {
    await entrarSujas(6);
    const lote = await enviar(6);
    await HigienizacaoService.remove(lote.id, ctx);

    const movs = await prisma.plasticCrateMovement.count({
      where: { crateCleaningId: lote.id },
    });
    expect(movs).toBe(0);
  });

  it("RECUSA excluir lote que já teve devolução", async () => {
    await entrarSujas(9);
    const lote = await enviar(9);
    await HigienizacaoService.registrarDevolucao(
      { id: lote.id, quantity: 2, returnedDate: hoje() },
      ctx,
    );
    await expect(HigienizacaoService.remove(lote.id, ctx)).rejects.toThrow(/devolução/i);
  });

  it("RECUSA excluir lote que já teve perda", async () => {
    await entrarSujas(7);
    const lote = await enviar(7);
    await HigienizacaoService.registrarPerda(
      { id: lote.id, quantity: 1, movementDate: hoje() },
      ctx,
    );
    await expect(HigienizacaoService.remove(lote.id, ctx)).rejects.toThrow(/perda/i);
  });

  it("RECUSA excluir lote que já teve pagamento", async () => {
    await entrarSujas(4);
    const lote = await enviar(4, 5);
    await HigienizacaoService.registrarPagamento(
      { id: lote.id, amount: 10, paidDate: hoje() },
      ctx,
    );
    await expect(HigienizacaoService.remove(lote.id, ctx)).rejects.toThrow(/pagamento/i);
  });
});

describe("Pendências da lista", () => {
  it("separa aguardando devolução de aguardando pagamento", async () => {
    const { aguardandoDevolucao, aguardandoPagamento, caixasAReceber } =
      await HigienizacaoService.list(tenantId);

    // Os testes acima deixaram lotes em cada situação.
    expect(aguardandoDevolucao).toBeGreaterThan(0);
    expect(aguardandoPagamento).toBeGreaterThan(0);
    expect(caixasAReceber).toBeGreaterThan(0);
  });
});
