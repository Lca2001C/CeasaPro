import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { PushAvisosService } from "@/lib/services/push-avisos.service";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Cron diário de avisos por push.
 *
 * O envio em si é mockado: mandar de verdade exigiria falar com o FCM, e o que
 * está sob teste não é a entrega — é a DECISÃO de quem recebe. As três regras de
 * produto que sustentam o desenho estão aqui, e todas as três falham em silêncio:
 *
 * - uma notificação por empresa por dia (não uma por aviso);
 * - dedupe por auditoria, para o retry da plataforma não notificar duas vezes;
 * - empresa bloqueada não recebe (a notificação levaria à tela de suspensão).
 */

// Só o envio ao serviço de push é mockado — `isPushConfigured` devolve true para
// o cron não desistir na primeira linha por falta de chave VAPID no ambiente.
const push = vi.hoisted(() => ({ enviar: vi.fn() }));

vi.mock("@/lib/pwa/push-server", () => ({
  isPushConfigured: () => true,
  enviarPushParaUsuario: push.enviar,
}));

const uniq = () => Math.random().toString(36).slice(2, 10);
const tenants: string[] = [];
let planId = "";

const dias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

/** Envio bem-sucedido: uma inscrição aceita, nenhuma morta. */
const aceitou = { enviados: 1, removidos: 0, falhas: 0 };

interface Cenario {
  /** Cria despesa vencida (gera aviso). Sem isto a empresa não tem o que avisar. */
  comAviso?: boolean;
  status?: "ACTIVE" | "SUSPENDED";
  subStatus?: "ATIVO" | "SUSPENSO" | "VENCIDO" | "TRIAL";
  /** Inscrições de push a criar. `0` = ninguém inscrito. */
  aparelhos?: number;
  /** Campos extras da assinatura (datas, cancelamento, troca agendada). */
  assinatura?: Partial<Prisma.TenantSubscriptionUncheckedCreateInput>;
}

async function empresa(c: Cenario): Promise<{ tenantId: string; userId: string }> {
  const tenantId = await createTestTenant("PUSH AVISO");
  tenants.push(tenantId);

  if (c.status === "SUSPENDED") {
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } });
  }

  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: c.subStatus ?? "ATIVO",
      monthlyAmount: 49.9,
      activatedAt: new Date("2026-01-10T00:00:00Z"),
      currentPeriodEnd: dias(20),
      graceDays: 5,
      ...c.assinatura,
    },
  });

  const user = await prisma.user.create({
    data: {
      tenantId,
      name: "Dono Aviso",
      email: `aviso-${uniq()}@teste.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });

  for (let i = 0; i < (c.aparelhos ?? 1); i++) {
    await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        tenantId,
        endpoint: `https://fcm.googleapis.com/fcm/send/${uniq()}`,
        p256dh: "p",
        auth: "a",
      },
    });
  }

  if (c.comAviso) {
    await prisma.expense.create({
      data: {
        tenantId,
        description: "Aluguel do box",
        amount: 300,
        type: "FIXA",
        status: "PENDENTE",
        dueDate: dias(-3), // vencida
      },
    });
  }

  return { tenantId, userId: user.id };
}

const marcasDeDedupe = (tenantId: string) =>
  prisma.auditLog.count({ where: { tenantId, action: "PUSH_AVISO_SENT" } });

/** Só os envios feitos para este usuário, ignorando as outras empresas do banco. */
const enviosPara = (userId: string) =>
  push.enviar.mock.calls.filter((c) => c[0] === userId);

beforeAll(async () => {
  const plan = await prisma.plan.create({
    data: {
      name: "Plano Push",
      slug: `push-${uniq()}`,
      priceMonthly: 49.9,
      active: true,
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await prisma.pushSubscription.deleteMany({ where: { tenantId: { in: tenants } } });
  await cleanupTenants(tenants);
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
});

beforeEach(() => {
  push.enviar.mockReset();
  push.enviar.mockResolvedValue(aceitou);
});

describe("PushAvisosService.enviarAvisosDiarios", () => {
  it("envia para empresa ativa com aviso e grava a marca de dedupe", async () => {
    const { tenantId, userId } = await empresa({ comAviso: true });

    const r = await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(1);
    expect(r.enviados).toBeGreaterThanOrEqual(1);
    expect(await marcasDeDedupe(tenantId)).toBe(1);

    const payload = enviosPara(userId)[0]![1] as {
      title: string;
      body: string;
      url: string;
      tag: string;
    };
    expect(payload.body).toContain("despesa");
    // Com UMA conta vencida, a notificação leva à PRÓPRIA despesa — antes caía
    // na lista inteira e a pessoa tinha de procurar entre meses de histórico.
    expect(payload.url.startsWith("/despesas/")).toBe(true);
    expect(payload.url.length).toBeGreaterThan("/despesas/".length);
    // `tag` fixa: o aviso de hoje substitui o de ontem na bandeja em vez de
    // empilhar uma pilha que ninguém lê.
    expect(payload.tag).toBe("avisos-operacionais");
  });

  it("uma notificação por empresa, mesmo com vários avisos", async () => {
    const { tenantId, userId } = await empresa({ comAviso: true });
    // Segundo aviso: despesa a vencer nos próximos 7 dias.
    await prisma.expense.create({
      data: {
        tenantId,
        description: "Energia",
        amount: 120,
        type: "VARIAVEL",
        status: "PENDENTE",
        dueDate: dias(2),
      },
    });

    await PushAvisosService.enviarAvisosDiarios();

    const chamadas = enviosPara(userId);
    expect(chamadas).toHaveLength(1);
    const payload = chamadas[0]![1] as { title: string; body: string };
    expect(payload.title).toContain("2 avisos");
    // Os dois cabem no corpo; o separador confirma que foi resumido numa só.
    expect(payload.body).toContain("·");
  });

  it("não reenvia na segunda execução do mesmo dia (retry do cron)", async () => {
    const { tenantId, userId } = await empresa({ comAviso: true });

    await PushAvisosService.enviarAvisosDiarios();
    expect(enviosPara(userId)).toHaveLength(1);

    push.enviar.mockClear();
    const r2 = await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(0);
    expect(r2.pulados).toBeGreaterThanOrEqual(1);
    expect(await marcasDeDedupe(tenantId)).toBe(1);
  });

  it("volta a enviar depois da janela de dedupe", async () => {
    const { tenantId, userId } = await empresa({ comAviso: true });
    await PushAvisosService.enviarAvisosDiarios();
    push.enviar.mockClear();

    // 21h depois: fora da janela de 20h, que é folgada de propósito para o
    // atraso de uma execução não silenciar o aviso do dia seguinte.
    const amanha = new Date(Date.now() + 21 * 60 * 60 * 1000);
    await PushAvisosService.enviarAvisosDiarios(amanha);

    expect(enviosPara(userId)).toHaveLength(1);
    expect(await marcasDeDedupe(tenantId)).toBe(2);
  });

  it("empresa sem aviso nenhum não recebe notificação", async () => {
    const { tenantId, userId } = await empresa({ comAviso: false });

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(0);
    // Sem marca de dedupe: nada foi enviado, então amanhã pode enviar.
    expect(await marcasDeDedupe(tenantId)).toBe(0);
  });

  it("empresa com acesso bloqueado não recebe", async () => {
    const { tenantId, userId } = await empresa({
      comAviso: true,
      status: "SUSPENDED",
      subStatus: "SUSPENSO",
    });

    await PushAvisosService.enviarAvisosDiarios();

    // Tocar na notificação levaria a pessoa para /conta/suspensa, não ao aviso.
    expect(enviosPara(userId)).toHaveLength(0);
    expect(await marcasDeDedupe(tenantId)).toBe(0);
  });

  it("empresa excluída (soft delete) não recebe", async () => {
    const { tenantId, userId } = await empresa({ comAviso: true });
    await prisma.tenant.update({ where: { id: tenantId }, data: { deletedAt: new Date() } });

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(0);
  });

  /**
   * O bloqueio do USUÁRIO também tem de valer, não só o da empresa.
   *
   * Nem `desativarUsuario` nem as exclusões apagam a inscrição (o admin nunca
   * toca em `pushSubscription`), e o logout não cancela a inscrição do
   * navegador. Quem perdeu o acesso seguia recebendo o aviso diário — com o
   * movimento no corpo da notificação — e o toque só levava ao login.
   */
  it("usuário desativado não recebe mais o aviso diário", async () => {
    const { userId } = await empresa({ comAviso: true });
    await prisma.user.update({ where: { id: userId }, data: { active: false } });

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(0);
  });

  it("usuário excluído não recebe mais o aviso diário", async () => {
    const { userId } = await empresa({ comAviso: true });
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(0);
  });

  it("falha no serviço de push NÃO grava a marca: amanhã tenta de novo", async () => {
    const { tenantId, userId } = await empresa({ comAviso: true });
    push.enviar.mockResolvedValue({ enviados: 0, removidos: 0, falhas: 1 });

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(1);
    // Nada saiu de fato. Marcar como avisado silenciaria o aviso de amanhã.
    expect(await marcasDeDedupe(tenantId)).toBe(0);
  });

  it("conta as inscrições mortas removidas pelo envio", async () => {
    const { userId } = await empresa({ comAviso: true });
    push.enviar.mockResolvedValue({ enviados: 0, removidos: 2, falhas: 0 });

    const r = await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(1);
    expect(r.inscricoesRemovidas).toBeGreaterThanOrEqual(2);
  });

  it("empresa sem ninguém inscrito não entra no cálculo de avisos", async () => {
    const { userId } = await empresa({ comAviso: true, aparelhos: 0 });

    await PushAvisosService.enviarAvisosDiarios();

    // Varrer a base para calcular avisos que ninguém receberia é custo puro.
    expect(enviosPara(userId)).toHaveLength(0);
  });
});

/**
 * Status RECALCULADO, não o gravado.
 *
 * O status no banco só é recalculado pelo cron de billing (13:30); este roda às
 * 06:30. Teste grátis que acabou de madrugada ainda estava TRIAL no banco,
 * recebia o resumo, e o toque caía em /conta/suspensa.
 */
describe("Bloqueio decidido pelas datas, como no login", () => {
  it("teste grátis vencido (gravado ainda TRIAL) não recebe", async () => {
    const { tenantId, userId } = await empresa({
      comAviso: true,
      subStatus: "TRIAL",
      assinatura: { activatedAt: null, trialEndsAt: dias(-0.3) },
    });

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(0);
    expect(await marcasDeDedupe(tenantId)).toBe(0);
  });

  it("teste grátis ainda valendo recebe", async () => {
    const { userId } = await empresa({
      comAviso: true,
      subStatus: "TRIAL",
      assinatura: { activatedAt: null, trialEndsAt: dias(3) },
    });

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(1);
  });

  it("cancelou e o mês pago acabou de madrugada (gravado ainda ATIVO) não recebe", async () => {
    const { userId } = await empresa({
      comAviso: true,
      subStatus: "ATIVO",
      assinatura: { cancelledAt: dias(-20), currentPeriodEnd: dias(-0.2) },
    });

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(0);
  });

  it("VENCIDO além da tolerância (gravado ainda VENCIDO) não recebe", async () => {
    const { userId } = await empresa({
      comAviso: true,
      subStatus: "VENCIDO",
      assinatura: { currentPeriodEnd: dias(-6), graceDays: 5 },
    });

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(0);
  });
});

describe("Troca de plano agendada que já venceu", () => {
  let comHig = "";
  let semHig = "";

  beforeAll(async () => {
    comHig = (
      await prisma.plan.create({
        data: {
          name: "Com hig",
          slug: `push-hig-${uniq()}`,
          priceMonthly: 99,
          active: true,
          features: { modules: ["higienizacao"] },
        },
      })
    ).id;
    semHig = (
      await prisma.plan.create({
        data: {
          name: "Sem hig",
          slug: `push-nohig-${uniq()}`,
          priceMonthly: 49,
          active: true,
          features: { modules: [] },
        },
      })
    ).id;
  });

  afterAll(async () => {
    const ids = [comHig, semHig];
    await prisma.tenantSubscription.deleteMany({
      where: { OR: [{ planId: { in: ids } }, { pendingPlanId: { in: ids } }] },
    });
    await prisma.plan.deleteMany({ where: { id: { in: ids } } });
  });

  async function comHigienizacaoPendente(tenantId: string) {
    await prisma.crateCleaning.create({
      data: {
        tenantId,
        cleanerName: "Lavador",
        sentDate: dias(-2),
        sentQty: 10,
        unitPrice: 2,
        totalAmount: 20,
      },
    });
  }

  it("módulo que o downgrade já tirou não vira notificação", async () => {
    const { tenantId, userId } = await empresa({
      comAviso: false,
      assinatura: { planId: comHig, pendingPlanId: semHig, pendingPlanFrom: dias(-0.1) },
    });
    await comHigienizacaoPendente(tenantId);

    await PushAvisosService.enviarAvisosDiarios();

    // O único aviso seria "Higienização a pagar", e o toque cairia no paywall.
    expect(enviosPara(userId)).toHaveLength(0);
  });

  it("antes da data da troca, o plano vigente ainda vale", async () => {
    const { tenantId, userId } = await empresa({
      comAviso: false,
      assinatura: { planId: comHig, pendingPlanId: semHig, pendingPlanFrom: dias(5) },
    });
    await comHigienizacaoPendente(tenantId);

    await PushAvisosService.enviarAvisosDiarios();

    expect(enviosPara(userId)).toHaveLength(1);
  });
});

describe("Execuções sobrepostas do cron", () => {
  it("duas rodadas ao mesmo tempo mandam UMA notificação", async () => {
    const { tenantId, userId } = await empresa({ comAviso: true });
    // Envio lento: é nesse intervalo que a segunda rodada passava pela checagem.
    push.enviar.mockImplementation(
      () => new Promise((r) => setTimeout(() => r(aceitou), 150)),
    );

    await Promise.all([
      PushAvisosService.enviarAvisosDiarios(),
      PushAvisosService.enviarAvisosDiarios(),
    ]);

    expect(enviosPara(userId)).toHaveLength(1);
    expect(await marcasDeDedupe(tenantId)).toBe(1);
  });

  it("exceção no envio libera a reserva", async () => {
    const { tenantId, userId } = await empresa({ comAviso: true });
    push.enviar.mockImplementation(async (id: string) => {
      if (id === userId) throw new Error("rede caiu");
      return aceitou;
    });

    await PushAvisosService.enviarAvisosDiarios();

    expect(await marcasDeDedupe(tenantId)).toBe(0);
  });
});
