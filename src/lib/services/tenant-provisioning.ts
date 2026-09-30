import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { emailIdentity } from "@/lib/email-identity";
import { normalizarCnpj } from "@/lib/cnpj";
import { formatCNPJ } from "@/lib/format";
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

/**
 * Existe conta ATIVA (não excluída) com este e-mail?
 *
 * A pergunta é sobre a CAIXA DE ENTRADA, não sobre o texto do endereço.
 * `dono@gmail.com`, `dono+teste@gmail.com` e `d.o.n.o@gmail.com` são o mesmo
 * destino, e comparar como texto fazia dos apelidos do próprio provedor uma
 * fábrica de testes grátis: cada variação recebia o link de confirmação na mesma
 * caixa e ganhava mais 7 dias. `emailIdentity` é a forma raiz; `email` continua
 * sendo o endereço digitado, porque é para ele que a mensagem vai.
 *
 * O `OR` com o endereço literal cobre as contas anteriores ao backfill da
 * migration e qualquer linha gravada por um caminho que não passe por
 * `provisionTenant` — sem ele, a checagem ficaria mais fraca do que era.
 */
export async function emailEmUso(email: string): Promise<boolean> {
  const existing = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [{ email }, { emailIdentity: emailIdentity(email) }],
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Existe empresa ATIVA com este CNPJ?
 *
 * A coluna é `@unique` e global. Sem esta checagem, a colisão chegava como
 * P2002 e virava "Ocorreu um erro inesperado. Tente novamente. (ref: …)" —
 * mensagem que não diz o motivo e convida a repetir algo que nunca vai dar
 * certo. `null` e vazio nunca colidem (ver `cnpjSchema`).
 */
export async function cnpjEmUso(
  cnpj: string | null | undefined,
  exceto?: string,
): Promise<boolean> {
  if (!cnpj) return false;
  // O schema passou a gravar só dígitos, mas linhas antigas guardam o texto
  // como foi digitado — em geral com a máscara. Comparar as duas formas é o
  // que impede o mesmo CNPJ de entrar de novo só por vir sem pontuação.
  const digitos = normalizarCnpj(cnpj);
  const formas = [
    ...new Set([cnpj, digitos, ...(digitos.length === 14 ? [formatCNPJ(digitos)] : [])]),
  ].filter(Boolean);
  const existing = await prisma.tenant.findFirst({
    where: {
      cnpj: { in: formas },
      deletedAt: null,
      ...(exceto ? { id: { not: exceto } } : {}),
    },
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
    data: {
      email: emailDeExcluido(excluido.id, excluido.email),
      // A identidade sai junto com o e-mail: ela é a chave de "já tem conta", e
      // uma conta excluída não tem que segurar endereço nenhum.
      emailIdentity: null,
    },
  });
}

export interface ProvisionTenantInput {
  tradeName: string;
  legalName?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  establishmentType?: string | null;
  uf?: string | null;
  ceasaCentralCode?: string | null;
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
      uf: input.uf ?? null,
      ceasaCentralCode: input.ceasaCentralCode ?? null,
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
          // Carimbada na criação, nos DOIS caminhos (cadastro público e cadastro
          // pelo admin): é o que `emailEmUso` consulta.
          emailIdentity: emailIdentity(input.owner.email),
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
