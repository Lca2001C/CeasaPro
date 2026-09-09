import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Fluxo PIX de ponta a ponta: gerar cobrança → pagar → liberar acesso.
 *
 * O gateway é mockado, mas o mock imita o comportamento REAL que quebrava o
 * fluxo: a **idempotência** do Mercado Pago, que devolve a mesma cobrança para
 * a mesma chave. É daí que vinham os estados travados.
 */
const gw = vi.hoisted(() => ({
  chamadas: 0,
  /** Chave de idempotência → cobrança devolvida, como o MP faz. */
  porChave: new Map<string, string>(),
  ultimoPayload: null as Record<string, unknown> | null,
  status: new Map<string, string>(),
  /** Valor de cada cobrança — o `transaction_amount` que o MP devolve. */
  valores: new Map<string, number>(),
}));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
    createPixPayment: vi.fn(
      async (args: {
        amount: number;
        externalReference: string;
        payerEmail: string;
        payerName?: string | null;
        payerIdentification?: { type: string; number: string } | null;
        expiresAt: Date;
      }) => {
        gw.ultimoPayload = { ...args };
        // Mesma chave que o serviço usa: referência externa + valor.
        const chave = `pix:${args.externalReference}:${args.amount.toFixed(2)}`;
        let id = gw.porChave.get(chave);
        if (!id) {
          gw.chamadas += 1;
          id = `mp-pix-${gw.chamadas}`;
          gw.porChave.set(chave, id);
          gw.status.set(id, "pending");
        }
        gw.valores.set(id, args.amount);
        return {
          mpPaymentId: id,
          status: gw.status.get(id) ?? "pending",
          qrCode: `00020126580014BR.GOV.BCB.PIX-${id}`,
          qrCodeBase64: "aW1hZ2VtLXBuZw==",
          ticketUrl: `https://mp.fake/${id}`,
          expiresAt: args.expiresAt,
        };
      },
    ),
    getPayment: vi.fn(async (id: string) => {
      const status = gw.status.get(id) ?? "pending";
      return {
        id,
        status,
        statusDetail: status,
        externalReference: null,
        // O fake devolvia 0 aqui. O serviço confere o valor pago contra a
        // mensalidade devida, então um 0 fixo tornaria todo pagamento
        // "a menos" e o fake deixaria de representar a realidade.
        amount: gw.valores.get(id) ?? 0,
        method: "pix",
        paymentTypeId: "bank_transfer",
        paidAt: status === "approved" ? new Date() : null,
      };
    }),
    verifyWebhookSignature: (args: { dataId: string | null }) => args.dataId,
  };
});

import { BillingService } from "@/lib/services/billing.service";
import { temPagamentoPix } from "@/lib/payments/pix-charge";

const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
let planoBasico = "";
let planoCompleto = "";

/** Empresa nova: suspensa, nunca pagou. */
async function novoCliente(): Promise<{ tenantId: string; ctx: TenantCtx }> {
  const tenantId = await createTestTenant("PIX FLUXO");
  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: planoBasico,
      status: "SUSPENSO",
      monthlyAmount: 49.9,
      activatedAt: null,
      currentPeriodEnd: new Date("2026-01-01T00:00:00Z"),
      graceDays: 5,
    },
  });
  await prisma.user.create({
    data: {
      tenantId,
      name: "Maria da Silva",
      email: `dono-${uniq()}@t.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  tenants.push(tenantId);
  return { tenantId, ctx: makeCtx(tenantId) };
}

beforeAll(async () => {
  const b = await prisma.plan.create({
    data: { name: "Básico PIX", slug: `bas-pix-${uniq()}`, priceMonthly: 49.9, active: true },
  });
  const c = await prisma.plan.create({
    data: { name: "Completo PIX", slug: `com-pix-${uniq()}`, priceMonthly: 99.9, active: true },
  });
  planoBasico = b.id;
  planoCompleto = c.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.deleteMany({ where: { id: { in: [planoBasico, planoCompleto] } } });
});

describe("Gerar cobrança PIX", () => {
  it("devolve algo pagável: QR, copia-e-cola e validade", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    expect(cobranca.status).toBe("PENDENTE");
    expect(cobranca.method).toBe("PIX");
    expect(cobranca.qrCode).toContain("BR.GOV.BCB.PIX");
    expect(cobranca.qrCodeBase64).toBeTruthy();
    expect(cobranca.expiresAt).toBeTruthy();
    // É o que a tela usa para decidir se mostra o painel de pagamento.
    expect(temPagamentoPix({ ...cobranca, amount: cobranca.amount.toString() })).toBe(true);
  });

  it("manda ao Mercado Pago os dados que a API exige do pagador", async () => {
    const { tenantId, ctx } = await novoCliente();
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { cnpj: "12345678000199" },
    });
    await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx);

    const payload = gw.ultimoPayload!;
    expect(payload.payerEmail).toMatch(/@/);
    expect(payload.payerName).toBe("Maria da Silva");
    expect(payload.payerIdentification).toEqual({ type: "CNPJ", number: "12345678000199" });
    // Validade no futuro — o MP recusa cobrança já vencida.
    expect((payload.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });


  it("é idempotente no mês: segunda chamada devolve a MESMA cobrança", async () => {
    const { tenantId, ctx } = await novoCliente();
    const a = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    const b = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    expect(b.id).toBe(a.id);
    const quantas = await prisma.subscriptionPayment.count({
      where: { tenantId, status: "PENDENTE" },
    });
    expect(quantas).toBe(1);
  });

  it("cobrança vencida é substituída por uma NOVA, utilizável", async () => {
    const { tenantId, ctx } = await novoCliente();
    const antiga = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    // Vence a cobrança e a chave de idempotência do MP (24h no mundo real).
    await prisma.subscriptionPayment.update({
      where: { id: antiga.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    gw.porChave.clear();

    const nova = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    expect(nova.id).not.toBe(antiga.id);
    expect(nova.status).toBe("PENDENTE");
    expect(nova.qrCode).toBeTruthy();
    expect(
      (await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: antiga.id } })).status,
    ).toBe("CANCELADO");
  });

  it("regenerar quando o MP devolve a MESMA cobrança não deixa o registro CANCELADO", async () => {
    // Era o bug: cancelávamos a linha e o `upsert` a atualizava sem voltar o
    // status. Ficava um QR válido na tela ligado a uma cobrança CANCELADA, e o
    // polling — que procura PENDENTE — nunca confirmava o pagamento.
    const { tenantId, ctx } = await novoCliente();
    const primeira = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    await prisma.subscriptionPayment.update({
      where: { id: primeira.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    // NÃO limpa `gw.porChave`: o MP devolve a mesma cobrança (idempotência viva).

    const segunda = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    expect(segunda.id).toBe(primeira.id);
    expect(segunda.status).toBe("PENDENTE");
    expect(segunda.qrCode).toBeTruthy();

    // E a tela de status precisa enxergar essa cobrança.
    const status = await BillingService.getStatus(tenantId);
    expect(status?.pendingCharge?.id).toBe(segunda.id);
  });

  it("não reabre cobrança já paga", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    gw.status.set(cobranca.mpPaymentId!, "approved");
    await BillingService.handleWebhook(cobranca.mpPaymentId!);

    // Mês já pago: o serviço recusa nova cobrança antes mesmo de chamar o MP.
    await expect(
      BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx),
    ).rejects.toThrow(/já está paga/i);
  });
});

describe("Troca de plano no PIX", () => {
  it("gera QR novo com o valor do plano escolhido", async () => {
    const { tenantId, ctx } = await novoCliente();
    const basico = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    expect(Number(basico.amount)).toBe(49.9);

    const completo = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true, planId: planoCompleto },
      ctx,
    );

    // Pagar 49,90 e receber o plano de 99,90 seria prejuízo silencioso.
    expect(completo.id).not.toBe(basico.id);
    expect(Number(completo.amount)).toBe(99.9);
    expect(gw.ultimoPayload!.amount).toBe(99.9);
  });

  /**
   * O código antigo continua pagável no Mercado Pago.
   *
   * Trocar de plano marca a cobrança anterior como CANCELADO só no NOSSO
   * banco — não existe cancelamento no gateway. O copia-e-cola de 49,90 já
   * estava no app do banco, e pagá-lo creditava o mês INTEIRO no plano de
   * 99,90: prejuízo silencioso, e depois disso a guarda MENSALIDADE_JA_PAGA
   * bloqueava a cobrança correta do mês.
   */
  it("pagar o código ANTIGO, mais barato, não libera o plano novo", async () => {
    const { tenantId, ctx } = await novoCliente();
    const basico = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true, planId: planoCompleto },
      ctx,
    );
    const antes = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(Number(antes.monthlyAmount)).toBe(99.9);

    // O cliente paga o QR velho, de 49,90.
    gw.status.set(basico.mpPaymentId!, "approved");
    const r = await BillingService.handleWebhook(basico.mpPaymentId!);
    expect(r).toBe("ignorado");

    // Nada de mês creditado nem de acesso liberado.
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("SUSPENSO");
    expect(sub.activatedAt).toBeNull();
    expect(sub.currentPeriodEnd.getTime()).toBe(antes.currentPeriodEnd.getTime());

    // A linha fica intocada: a tela segue oferecendo o pagamento correto, em
    // vez de dizer "já pago neste mês" e manter a empresa bloqueada.
    const velha = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id: basico.id },
    });
    expect(velha.status).not.toBe("APROVADO");
    expect((await BillingService.getStatus(tenantId))?.paidCharge).toBeNull();
  });

  it("pagar o valor devido libera normalmente (a guarda não atrapalha o certo)", async () => {
    const { tenantId, ctx } = await novoCliente();
    await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    const completo = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true, planId: planoCompleto },
      ctx,
    );

    gw.status.set(completo.mpPaymentId!, "approved");
    expect(await BillingService.handleWebhook(completo.mpPaymentId!)).toBe("aplicado");

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("ATIVO");
  });
});

describe("Pagamento confirmado pelo webhook", () => {
  it("ativa a assinatura, avança o vencimento e libera o acesso", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    gw.status.set(cobranca.mpPaymentId!, "approved");
    const r = await BillingService.handleWebhook(cobranca.mpPaymentId!);
    expect(r).toBe("aplicado");

    const paga = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id: cobranca.id },
    });
    expect(paga.status).toBe("APROVADO");
    expect(paga.paidAt).toBeTruthy();

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("ATIVO");
    expect(sub.activatedAt).toBeTruthy();
    // Empresa que nunca pagou tem vencimento no passado: o ciclo recomeça hoje,
    // senão o mês recém-pago já nasceria vencido.
    expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());

    // É isto que o polling da tela consulta para liberar o acesso.
    const status = await BillingService.getStatus(tenantId);
    expect(Boolean(status?.paidCharge)).toBe(true);
  });

  it("reentrega do mesmo webhook não avança o vencimento de novo", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    gw.status.set(cobranca.mpPaymentId!, "approved");
    await BillingService.handleWebhook(cobranca.mpPaymentId!);

    const antes = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    const r = await BillingService.handleWebhook(cobranca.mpPaymentId!);
    const depois = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });

    expect(r).toBe("ignorado");
    expect(depois.currentPeriodEnd.toISOString()).toBe(antes.currentPeriodEnd.toISOString());
  });

  it("webhook perdido é curado pela reconciliação do cron", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    // Pagou no banco, mas a notificação nunca chegou.
    gw.status.set(cobranca.mpPaymentId!, "approved");
    await prisma.subscriptionPayment.update({
      where: { id: cobranca.id },
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    await BillingService.reconcilePendingPayments();

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("ATIVO");
  });
});

/**
 * Cobrança vencida não pode trancar a tela de pagamento.
 *
 * A tela esconde o seletor de plano, o formulário de cartão e o botão de gerar
 * código enquanto existe cobrança pendente. Como `getStatus` devolvia a linha
 * vencida como pendente, quem gerava o PIX e não pagava em 48h voltava e
 * encontrava o QR morto com "Aguardando o pagamento" — e empresa SUSPENSA só
 * alcança /assinatura, então ficava sem nenhuma forma de pagar.
 */
describe("Cobrança PIX vencida", () => {
  it("sai de `pendingCharge` e devolve a tela de pagamento ao cliente", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    // Enquanto vale, a tela mostra o QR — comportamento preservado.
    const antes = await BillingService.getStatus(tenantId);
    expect(antes?.pendingCharge?.id).toBe(cobranca.id);

    // Passaram-se as 48h sem pagamento.
    await prisma.subscriptionPayment.update({
      where: { id: cobranca.id },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });

    const depois = await BillingService.getStatus(tenantId);
    expect(depois?.pendingCharge).toBeNull();
    // A linha continua no banco (o cron ainda vai conciliá-la); o que muda é
    // que ela não é mais oferecida como cobrança em aberto.
    expect(
      await prisma.subscriptionPayment.findUnique({ where: { id: cobranca.id } }),
    ).not.toBeNull();
  });

  it("e a tela volta a oferecer cobrança utilizável depois de gerar de novo", async () => {
    // Fecha o ciclo do ponto de vista da tela: o QR morto sai de `pendingCharge`
    // (teste acima), o cliente clica em gerar e o status volta a apontar uma
    // cobrança válida. A regeneração em si já tem teste próprio; o que faltava
    // era garantir que `getStatus` a reconhece.
    const { tenantId, ctx } = await novoCliente();
    const velha = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    await prisma.subscriptionPayment.update({
      where: { id: velha.id },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });

    // Com só a linha vencida, a tela não recebe cobrança nenhuma...
    expect((await BillingService.getStatus(tenantId))?.pendingCharge).toBeNull();

    const nova = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    // ...e depois de gerar, recebe de novo — com validade no futuro.
    expect(temPagamentoPix({ ...nova, amount: nova.amount.toString() })).toBe(true);
    const status = await BillingService.getStatus(tenantId);
    expect(status?.pendingCharge?.id).toBe(nova.id);
    expect(status?.pendingCharge?.expiresAt?.getTime()).toBeGreaterThan(
      new Date("2020-01-02T00:00:00Z").getTime(),
    );
  });
});

/**
 * A reconciliação é a ÚNICA rede para webhook perdido.
 *
 * O webhook responde na hora e processa em `after()`, então uma queda de
 * instância engole o evento em silêncio: a empresa pagou e fica SUSPENSA
 * vendo "Aguardando o pagamento", porque a tela libera o acesso olhando
 * `paidThisMonth`.
 *
 * O lote era um só (`OR: [PENDENTE, APROVADO]`, `take: 200`, mais antigas
 * primeiro). As APROVADAS são reconsultadas todo dia por dois meses e são
 * sempre mais antigas que as pendentes de hoje — a partir de ~100 empresas
 * pagantes o lote fechava sem alcançar uma única pendente.
 */
describe("Reconciliação com muitas cobranças aprovadas", () => {
  it("resgata a pendente mesmo com o lote cheio de aprovadas mais antigas", async () => {
    const { tenantId, ctx } = await novoCliente();
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });

    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    // Pagou no banco; a notificação nunca chegou.
    gw.status.set(cobranca.mpPaymentId!, "approved");
    // Mais velha que a idade mínima, senão a rotina a ignora de propósito.
    await prisma.subscriptionPayment.update({
      where: { id: cobranca.id },
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    // 200 aprovadas ANTERIORES a ela: é exatamente o teto do lote.
    const antigas = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.subscriptionPayment.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        subscriptionId: sub.id,
        tenantId,
        amount: 49.9,
        status: "APROVADO" as const,
        referenceMonth: cobranca.referenceMonth,
        mpPaymentId: `mp-antiga-${i}-${uniq()}`,
        createdAt: antigas,
        paidAt: antigas,
      })),
    });

    await BillingService.reconcilePendingPayments();

    const depois = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(depois.status).toBe("ATIVO");
  });
});
