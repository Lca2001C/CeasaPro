import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { SignupService } from "@/lib/services/signup.service";
import { buildAccessPayload } from "@/lib/auth/build-session";
import { hashVerifyToken, createVerifyToken } from "@/lib/auth/verify-token";
import { accessDecision, TRIAL_DAYS, trialEndFrom } from "@/lib/billing/status";
import { cleanupTenants } from "../helpers/factory";
import type { SignupInput } from "@/lib/validations/auth";

/**
 * Fluxo de cadastro público → confirmação → teste grátis → bloqueio.
 *
 * Sem SMTP configurado no ambiente de teste, `sendEmail` é no-op: nenhum destes
 * testes abre conexão de rede.
 */

const tenants: string[] = [];
const emails: string[] = [];
let planoBaratoId = "";
let planoCaroId = "";

const uniq = () => `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;

function entrada(over: Partial<SignupInput> = {}): SignupInput {
  const email = over.email ?? `cadastro-${uniq()}@teste-ceasapro.com.br`;
  emails.push(email);
  return {
    tradeName: "Hortifrúti do Teste",
    phone: "31999999999",
    establishmentType: "Box 42",
    password: "senha1234",
    ...over,
    // Sempre por último: o e-mail é o que foi registrado para limpeza.
    email,
  };
}

/** Registra e guarda o tenant para limpeza. */
async function registrar(input: SignupInput) {
  const res = await SignupService.register(input, { ip: "203.0.113.10" });
  if (res.tenantId) tenants.push(res.tenantId);
  return res;
}

beforeAll(async () => {
  // Dois planos: o cadastro deve entrar no MAIS BARATO dos ativos.
  const barato = await prisma.plan.create({
    data: {
      name: "Plano Teste Barato",
      slug: `teste-barato-${uniq()}`,
      priceMonthly: 99.9,
      active: true,
    },
  });
  const caro = await prisma.plan.create({
    data: {
      name: "Plano Teste Caro",
      slug: `teste-caro-${uniq()}`,
      priceMonthly: 499.9,
      active: true,
    },
  });
  planoBaratoId = barato.id;
  planoCaroId = caro.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
  // Usuários caem por cascade do tenant; sobra limpar os que não têm tenant.
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.plan.deleteMany({ where: { id: { in: [planoBaratoId, planoCaroId] } } });
});

describe("POST /api/auth/signup (via SignupService)", () => {
  it("cria a empresa SUSPENSA, sem teste liberado ainda", async () => {
    const input = entrada();
    const res = await registrar(input);

    expect(res.outcome).toBe("created");
    expect(res.tenantId).toBeTruthy();

    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: res.tenantId! },
    });
    // O teste grátis NÃO começa no cadastro: sem isto, e-mail descartável
    // renderia acesso ilimitado.
    expect(sub?.status).toBe("SUSPENSO");
    expect(sub?.trialEndsAt).toBeNull();
    expect(sub?.activatedAt).toBeNull();

    const user = await prisma.user.findFirst({ where: { email: input.email } });
    expect(user?.role).toBe("OWNER");
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.verifyTokenHash).toBeTruthy();
    // Senha escolhida pela própria pessoa: não há troca obrigatória.
    expect(user?.mustChangePassword).toBe(false);
  });

  it("guarda só o HASH do token — o token cru não fica no banco", async () => {
    const res = await registrar(entrada());
    const user = await prisma.user.findFirst({
      where: { tenantId: res.tenantId! },
      select: { verifyTokenHash: true },
    });
    expect(user!.verifyTokenHash).toBe(hashVerifyToken(res.devToken!));
    expect(user!.verifyTokenHash).not.toBe(res.devToken);
  });

  it("entra no plano ATIVO mais barato, com o valor vindo do plano", async () => {
    const res = await registrar(entrada());
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: res.tenantId! },
      include: { plan: true },
    });
    expect(sub?.planId).toBe(planoBaratoId);
    expect(Number(sub?.monthlyAmount)).toBe(99.9);
  });

  it("grava os dados do formulário na empresa", async () => {
    const res = await registrar(entrada({ establishmentType: "Banca 7" }));
    const tenant = await prisma.tenant.findUnique({ where: { id: res.tenantId! } });
    expect(tenant?.tradeName).toBe("Hortifrúti do Teste");
    expect(tenant?.phone).toBe("31999999999");
    expect(tenant?.establishmentType).toBe("Banca 7");
  });

  it("provisiona os padrões da empresa (categorias e embalagens)", async () => {
    const res = await registrar(entrada());
    const [cats, emb] = await Promise.all([
      prisma.expenseCategory.count({ where: { tenantId: res.tenantId! } }),
      prisma.packagingType.count({ where: { tenantId: res.tenantId! } }),
    ]);
    expect(cats).toBeGreaterThan(0);
    expect(emb).toBeGreaterThan(0);
  });

  it("e-mail JÁ CADASTRADO não cria nada e não vaza a existência da conta", async () => {
    const input = entrada();
    const primeiro = await registrar(input);
    expect(primeiro.outcome).toBe("created");

    const antes = await prisma.tenant.count();
    const segundo = await SignupService.register(input, { ip: "203.0.113.11" });
    const depois = await prisma.tenant.count();

    // Nenhuma empresa nova, e nenhum identificador devolvido que permita
    // distinguir este caso do cadastro bem-sucedido na resposta HTTP.
    expect(segundo.outcome).toBe("email_already_in_use");
    expect(segundo.tenantId).toBeUndefined();
    expect(depois).toBe(antes);
  });
});

describe("Confirmação do e-mail libera o teste grátis", () => {
  it("confirma, marca TRIAL e concede exatamente 7 dias", async () => {
    const res = await registrar(entrada());
    const antes = Date.now();

    const confirmado = await SignupService.confirmEmail(res.devToken!);

    const esperado = trialEndFrom(new Date(antes)).getTime();
    // Tolerância de alguns segundos para o tempo de execução do teste.
    expect(Math.abs(confirmado.trialEndsAt.getTime() - esperado)).toBeLessThan(10_000);

    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: res.tenantId! },
    });
    expect(sub?.status).toBe("TRIAL");
    expect(sub?.trialEndsAt).not.toBeNull();
    expect(sub?.activatedAt).toBeNull(); // trial não é pagamento

    const user = await prisma.user.findFirst({ where: { tenantId: res.tenantId! } });
    expect(user?.emailVerifiedAt).not.toBeNull();
  });

  it("depois de confirmar, a sessão do usuário libera o acesso", async () => {
    const res = await registrar(entrada());
    await SignupService.confirmEmail(res.devToken!);

    const payload = await buildAccessPayload(res.userId!);
    expect(payload?.subStatus).toBe("TRIAL");
    expect(accessDecision(payload!.tenantStatus, payload!.subStatus)).toBe("ok");
  });

  it("reabrir o link é idempotente e NÃO renova o teste", async () => {
    // Robô de e-mail que pré-carrega links, ou a pessoa clicando duas vezes.
    const res = await registrar(entrada());
    const primeira = await SignupService.confirmEmail(res.devToken!);
    const segunda = await SignupService.confirmEmail(res.devToken!);

    expect(segunda.trialEndsAt.getTime()).toBe(primeira.trialEndsAt.getTime());
  });

  it("token inexistente é recusado", async () => {
    const bogus = createVerifyToken().raw;
    await expect(SignupService.confirmEmail(bogus)).rejects.toThrow(/inválido|expirado/i);
  });

  it("token malformado é recusado sem consultar o banco", async () => {
    await expect(SignupService.confirmEmail("lixo")).rejects.toThrow(/inválido|expirado/i);
  });

  it("token expirado é recusado e não libera teste", async () => {
    const res = await registrar(entrada());
    await prisma.user.updateMany({
      where: { tenantId: res.tenantId! },
      data: { verifyTokenExpiresAt: new Date(Date.now() - 60_000) },
    });

    await expect(SignupService.confirmEmail(res.devToken!)).rejects.toThrow(/expirou/i);

    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: res.tenantId! },
    });
    expect(sub?.status).toBe("SUSPENSO");
    expect(sub?.trialEndsAt).toBeNull();
  });
});

describe("Fim do teste bloqueia o acesso", () => {
  it("teste expirado derruba a sessão para SUSPENSO (origem do 402/redirect)", async () => {
    const res = await registrar(entrada());
    await SignupService.confirmEmail(res.devToken!);

    // Recua o fim do teste para 1 dia atrás.
    await prisma.tenantSubscription.update({
      where: { tenantId: res.tenantId! },
      data: { trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    // `buildAccessPayload` recalcula E persiste — é o que faz o bloqueio
    // propagar para o proxy e para os guards de rota/action.
    const payload = await buildAccessPayload(res.userId!);
    expect(payload?.subStatus).toBe("SUSPENSO");
    expect(accessDecision(payload!.tenantStatus, payload!.subStatus)).toBe("blocked");

    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: res.tenantId! },
    });
    expect(sub?.status).toBe("SUSPENSO");
  });

  it("dentro do teste a mesma sessão continua liberada", async () => {
    const res = await registrar(entrada());
    await SignupService.confirmEmail(res.devToken!);

    const payload = await buildAccessPayload(res.userId!);
    expect(accessDecision(payload!.tenantStatus, payload!.subStatus)).toBe("ok");
  });

  it(`o teste concedido dura ${TRIAL_DAYS} dias, não mais`, async () => {
    const res = await registrar(entrada());
    await SignupService.confirmEmail(res.devToken!);

    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: res.tenantId! },
      select: { trialEndsAt: true, createdAt: true },
    });
    const dias =
      (sub!.trialEndsAt!.getTime() - sub!.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(dias).toBeGreaterThan(TRIAL_DAYS - 0.01);
    expect(dias).toBeLessThan(TRIAL_DAYS + 0.01);
  });
});
