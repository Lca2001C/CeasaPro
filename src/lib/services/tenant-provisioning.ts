import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createDefaultExpenseCategories } from "./expense-categories";
import { createDefaultPackagingTypes } from "./embalagens.service";

/**
 * Criação de empresa + usuário dono, compartilhada por dois caminhos que não
 * podem divergir: o cadastro feito pelo super-admin (`AdminService`) e o
 * autoatendimento público (`SignupService`).
 *
 * Antes isto vivia só dentro de `createTenantWithOwner`. Duplicar para o cadastro
 * público significaria manter em dois lugares as categorias de despesa padrão, os
 * tipos de embalagem padrão e — o que mais importa — a regra de que a assinatura
 * nasce SUSPENSA. Uma cópia esquecida ali seria acesso gratuito silencioso.
 *
 * O que NÃO entra aqui, de propósito: auditoria e e-mail. O admin registra a ação
 * com o ator que a executou; o cadastro público não tem ator e manda outro
 * e-mail. Cada chamador cuida do seu.
 */

/**
 * E-mail "carimbado" de um usuário excluído.
 *
 * `User.email` é `@unique` GLOBAL e o índice não sabe o que é `deletedAt`:
 * a linha excluída continua ocupando o endereço, e cadastrar de novo a mesma
 * pessoa estourava violação de índice único — que chegava à tela como
 * "Ocorreu um erro inesperado (ref: …)".
 *
 * Carimbar libera o endereço para um cadastro novo sem apagar a linha, que
 * precisa continuar existindo porque o `userId` é referenciado na auditoria.
 * O e-mail original fica legível (e também é guardado no log de auditoria).
 */
export function emailDeExcluido(userId: string, email: string): string {
  // Já carimbado (exclusão de empresa depois de exclusão de usuário): não
  // empilha prefixo em cima de prefixo.
  if (email.startsWith("excluido-")) return email;
  return `excluido-${userId}-${email}`;
}

/** Existe conta ATIVA (não excluída) com este e-mail? */
export async function emailEmUso(email: string): Promise<boolean> {
  const existing = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Libera o endereço que uma conta EXCLUÍDA ainda esteja segurando.
 *
 * A migration `20260829120000` já carimbou as antigas, mas isto cobre qualquer
 * linha que tenha escapado — e é justamente onde o cadastro quebrava com "erro
 * inesperado" em vez de uma mensagem.
 */
export async function liberarEmailDeContaExcluida(email: string): Promise<void> {
  const excluido = await prisma.user.findFirst({
    where: { email, deletedAt: { not: null } },
    select: { id: true, email: true },
  });
  if (!excluido) return;
  await prisma.user.update({
    where: { id: excluido.id },
    data: { email: emailDeExcluido(excluido.id, excluido.email) },
  });
}

export interface ProvisionTenantInput {
  tradeName: string;
  legalName?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  establishmentType?: string | null;
  planId: string;
  monthlyAmount: Prisma.Decimal | number | string;
  graceDays: number;
  currentPeriodEnd: Date;
  owner: {
    name: string;
    email: string;
    passwordHash: string;
    mustChangePassword: boolean;
    /** Cadastro público: e-mail ainda não confirmado, token pendente. */
    verifyTokenHash?: string | null;
    verifyTokenExpiresAt?: Date | null;
    /** Cadastro pelo admin: o contato já foi validado por quem cadastrou. */
    emailVerifiedAt?: Date | null;
  };
}

/**
 * Cria empresa, assinatura e usuário dono dentro da transação recebida.
 *
 * A assinatura nasce SEMPRE `SUSPENSO` com `activatedAt` e `trialEndsAt` nulos —
 * nenhum chamador pode abrir acesso na criação. O teste grátis é concedido depois,
 * pela confirmação do e-mail (`SignupService.confirmEmail`), e o acesso pago pelo
 * primeiro pagamento aprovado.
 */
export async function provisionTenant(
  tx: Prisma.TransactionClient,
  input: ProvisionTenantInput,
): Promise<{ tenantId: string; userId: string }> {
  const tenant = await tx.tenant.create({
    data: {
      tradeName: input.tradeName,
      legalName: input.legalName ?? null,
      cnpj: input.cnpj ?? null,
      phone: input.phone ?? null,
      establishmentType: input.establishmentType ?? null,
      status: "ACTIVE",
      subscription: {
        create: {
          planId: input.planId,
          status: "SUSPENSO",
          monthlyAmount: input.monthlyAmount,
          activatedAt: null,
          trialEndsAt: null,
          currentPeriodEnd: input.currentPeriodEnd,
          graceDays: input.graceDays,
        },
      },
      users: {
        create: {
          name: input.owner.name,
          email: input.owner.email,
          passwordHash: input.owner.passwordHash,
          role: "OWNER",
          mustChangePassword: input.owner.mustChangePassword,
          verifyTokenHash: input.owner.verifyTokenHash ?? null,
          verifyTokenExpiresAt: input.owner.verifyTokenExpiresAt ?? null,
          emailVerifiedAt: input.owner.emailVerifiedAt ?? null,
        },
      },
    },
    include: { users: { select: { id: true } } },
  });

  await createDefaultExpenseCategories(tenant.id, tx);
  await createDefaultPackagingTypes(tenant.id, tx);

  return { tenantId: tenant.id, userId: tenant.users[0]!.id };
}
