import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import {
  createVerifyToken,
  hashVerifyToken,
  looksLikeVerifyToken,
  VERIFY_TOKEN_TTL_HOURS,
} from "@/lib/auth/verify-token";
import { TRIAL_DAYS, trialEndFrom } from "@/lib/billing/status";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { absoluteUrl } from "@/lib/app-url";
import {
  sendEmail,
  verifyEmailEmail,
  signupAttemptOnExistingAccountEmail,
} from "@/lib/email";
import { BusinessRuleError } from "@/lib/http/app-error";
import {
  provisionTenant,
  emailEmUso,
  liberarEmailDeContaExcluida,
} from "./tenant-provisioning";
import { AdminNotificationsService } from "./admin-notifications.service";
import { ADMIN_PLAN_SLUG } from "./plano.service";
import type { SignupInput } from "@/lib/validations/auth";

/**
 * Cadastro público autoatendimento com 7 dias de teste.
 *
 * Duas decisões de segurança governam este arquivo:
 *
 * 1. **O trial só começa na confirmação do e-mail.** A empresa é criada
 *    SUSPENSA; `trialEndsAt` continua nulo até o clique no link. Sem isso, um
 *    e-mail descartável geraria acesso grátis ilimitado — e como não pedimos
 *    cartão, a confirmação é a única barreira de identidade que existe.
 *
 * 2. **A resposta nunca revela se o e-mail já tem conta.** Dizer "e-mail já
 *    cadastrado" transformaria o formulário num verificador de quem é cliente do
 *    CeasaPro; o login e o "esqueci minha senha" já foram endurecidos contra
 *    exatamente esse oráculo, e abrir um terceiro caminho anularia os dois. Quem
 *    é dono da caixa recebe um e-mail explicando; o resultado visível na tela é
 *    idêntico nos dois casos.
 */

export interface SignupResult {
  /** Só para log e teste. NUNCA vai para a resposta HTTP. */
  outcome: "created" | "email_already_in_use";
  tenantId?: string;
  userId?: string;
  /** Token cru, apenas em desenvolvimento (o link vai para o log). */
  devToken?: string;
}

export const SignupService = {
  /**
   * Cria a empresa em estado pendente de confirmação e dispara o e-mail.
   *
   * Deve ser chamado depois da resposta HTTP (dentro de `after()`): o trabalho
   * aqui inclui Argon2 e uma chamada de rede para o SMTP, e o tempo total
   * distinguiria e-mail novo de e-mail já cadastrado.
   */
  async register(input: SignupInput, ctx: { ip: string | null }): Promise<SignupResult> {
    if (await emailEmUso(input.email)) {
      // Nada é criado. O aviso vai para quem é dono do endereço.
      const { subject, html } = signupAttemptOnExistingAccountEmail({
        loginUrl: absoluteUrl("/login"),
        forgotUrl: absoluteUrl("/recuperar-senha"),
      });
      const sent = await sendEmail(input.email, subject, html, {
        tags: [{ name: "tipo", value: "cadastro-conta-existente" }],
      });
      if (!sent.ok) {
        logger.error({ err: sent.error }, "Falha ao avisar sobre cadastro em conta existente");
      }
      logger.info({ ip: ctx.ip }, "Cadastro em e-mail que já tem conta — nada criado");
      return { outcome: "email_already_in_use" };
    }

    await liberarEmailDeContaExcluida(input.email);

    const plan = await planoDeEntrada();
    const passwordHash = await hashPassword(input.password);
    const token = createVerifyToken();
    const now = new Date();

    const { tenantId, userId } = await prisma.$transaction(async (tx) => {
      const criado = await provisionTenant(tx, {
        tradeName: input.tradeName,
        phone: input.phone,
        establishmentType: input.establishmentType ?? null,
        planId: plan.id,
        // O valor mensal vem SEMPRE do plano, nunca do cliente — mesma regra de
        // `PlanoService.trocarPlano`.
        monthlyAmount: plan.priceMonthly,
        graceDays: 5,
        // Sem período pago ainda. `computeStatus` ignora esta data enquanto não
        // houver `activatedAt`, então ela não abre acesso.
        currentPeriodEnd: now,
        owner: {
          name: input.tradeName,
          email: input.email,
          passwordHash,
          // Senha escolhida pela própria pessoa: não há o que trocar no 1º acesso.
          mustChangePassword: false,
          verifyTokenHash: token.tokenHash,
          verifyTokenExpiresAt: token.expiresAt,
          emailVerifiedAt: null,
        },
      });
      await audit(
        {
          tenantId: criado.tenantId,
          userId: criado.userId,
          actorEmail: input.email,
          action: "CREATE",
          entity: "Tenant",
          entityId: criado.tenantId,
          newData: { tradeName: input.tradeName, origem: "cadastro-publico" },
          ip: ctx.ip,
        },
        tx,
      );
      return criado;
    });

    // ANTES do e-mail, de propósito: o aviso ao admin não depende do SMTP, e
    // deixá-lo depois fazia um servidor de e-mail lento atrasar o aviso pelo
    // tempo das três tentativas de envio — ou perdê-lo, se a requisição fosse
    // encerrada nesse meio. O serviço já engole as próprias falhas, então aqui
    // não há try/catch redundante.
    await AdminNotificationsService.notificarUsuarioCriado({
      tenantId,
      userId,
      tradeName: input.tradeName,
      email: input.email,
      origem: "cadastro-publico",
    });

    const link = absoluteUrl(`/cadastro/confirmar/${token.raw}`);
    const { subject, html } = verifyEmailEmail({
      link,
      trialDays: TRIAL_DAYS,
      expiresInHours: VERIFY_TOKEN_TTL_HOURS,
    });
    const sent = await sendEmail(input.email, subject, html, {
      tags: [{ name: "tipo", value: "confirmar-email" }],
    });
    if (!sent.ok) {
      // A pessoa já recebeu a resposta genérica; sem este log a falha ficaria
      // invisível e o cadastro pareceria ter sumido.
      logger.error({ err: sent.error, tenantId }, "Falha ao enviar e-mail de confirmação");
    }

    logger.info({ tenantId, ip: ctx.ip }, "Cadastro público criado, aguardando confirmação");

    return {
      outcome: "created",
      tenantId,
      userId,
      // Em dev não há SMTP: o link precisa sair em algum lugar para dar como
      // testar o fluxo inteiro sem caixa de e-mail (mesmo padrão do `forgot`).
      devToken: process.env.NODE_ENV === "production" ? undefined : token.raw,
    };
  },

  /**
   * Confirma o e-mail e LIBERA os 7 dias de teste.
   *
   * Duas propriedades que este método precisa ter ao mesmo tempo, e que quase se
   * contradizem:
   *
   * **Idempotente**, porque cliente de e-mail, antivírus e gateway corporativo
   * PRÉ-CARREGAM links. Se a primeira visita (a do robô) consumisse o token, a
   * pessoa clicaria e leria "link inválido" — com a conta já confirmada. Por isso
   * o token não é apagado aqui: continua valendo até expirar, e reabrir o link
   * devolve o mesmo resultado.
   *
   * **Não renovável**, porque um token que continua valendo por 24h e que
   * regrava `trialEndsAt` seria um botão de "renovar teste": bastaria reabrir o
   * link do e-mail para ganhar 7 dias de novo, para sempre. A concessão só
   * acontece se `trialEndsAt` ainda for nulo; depois disso a chamada é leitura.
   *
   * O que se perde em relação ao uso único do token de senha: quem obtiver o
   * link dentro da validade pode confirmar o e-mail. É aceitável porque é tudo
   * que o token autoriza — não dá acesso à conta, não define senha, e o trial
   * já foi concedido de qualquer forma.
   */
  async confirmEmail(rawToken: string): Promise<{ email: string; trialEndsAt: Date }> {
    if (!looksLikeVerifyToken(rawToken)) {
      throw new BusinessRuleError("Link inválido ou expirado.", "TOKEN_INVALIDO");
    }

    const user = await prisma.user.findFirst({
      where: { verifyTokenHash: hashVerifyToken(rawToken), deletedAt: null },
      select: {
        id: true,
        email: true,
        tenantId: true,
        verifyTokenExpiresAt: true,
        emailVerifiedAt: true,
        tenant: { select: { subscription: { select: { trialEndsAt: true } } } },
      },
    });

    if (!user || !user.tenantId) {
      throw new BusinessRuleError("Link inválido ou expirado.", "TOKEN_INVALIDO");
    }
    if (!user.verifyTokenExpiresAt || user.verifyTokenExpiresAt < new Date()) {
      throw new BusinessRuleError(
        "Este link expirou. Faça o cadastro de novo para receber outro.",
        "TOKEN_EXPIRADO",
      );
    }

    const tenantId = user.tenantId;
    const jaConcedido = user.tenant?.subscription?.trialEndsAt ?? null;

    // Já confirmado antes (robô de e-mail, ou a pessoa reabriu o link): devolve o
    // mesmo teste, sem estender nada.
    if (jaConcedido) {
      return { email: user.email, trialEndsAt: jaConcedido };
    }

    const now = new Date();
    const trialEndsAt = trialEndFrom(now);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? now },
      });
      // `trialEndsAt: null` no filtro fecha a corrida entre duas confirmações
      // simultâneas: a segunda não encontra linha e não sobrescreve a primeira.
      await tx.tenantSubscription.updateMany({
        where: { tenantId, trialEndsAt: null, activatedAt: null },
        data: { status: "TRIAL", trialEndsAt },
      });
      await audit(
        {
          tenantId,
          userId: user.id,
          actorEmail: user.email,
          action: "UPDATE",
          entity: "TenantSubscription",
          entityId: tenantId,
          newData: { status: "TRIAL", trialEndsAt: trialEndsAt.toISOString() },
        },
        tx,
      );
    });

    logger.info({ tenantId, trialEndsAt }, "E-mail confirmado — teste grátis liberado");

    return { email: user.email, trialEndsAt };
  },
};

/**
 * Plano em que o cadastro público entra: o ATIVO mais barato.
 *
 * Ler do banco em vez de fixar um slug evita que a vitrine e a cobrança
 * divirjam quando o preço mudar. O ambiente do super-admin tem um plano interno
 * (`ambiente-administrador`) que não pode ser oferecido a cliente.
 */
async function planoDeEntrada() {
  const plan = await prisma.plan.findFirst({
    where: { active: true, slug: { not: ADMIN_PLAN_SLUG } },
    orderBy: { priceMonthly: "asc" },
    select: { id: true, priceMonthly: true },
  });
  if (!plan) {
    // Sem plano ativo não há o que contratar depois do teste. Falhar aqui é
    // melhor que criar uma empresa que nunca conseguirá pagar.
    throw new BusinessRuleError(
      "Nenhum plano disponível para contratação. Fale com o suporte.",
      "SEM_PLANO",
    );
  }
  return plan;
}
