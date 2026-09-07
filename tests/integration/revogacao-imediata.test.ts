import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { buildAccessPayload } from "@/lib/auth/build-session";
import { revokeAllForUser, revokeAllForTenant } from "@/lib/auth/refresh";
import { assertSessaoValida } from "@/lib/auth/revogacao";
import { UnauthorizedError } from "@/lib/http/app-error";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Revogação de sessão em vigor IMEDIATO.
 *
 * A leitura da sessão é stateless: `getSession()` só verifica o JWT, e nenhum
 * wrapper revalidava contra o banco. Todos os pontos de revogação mexiam apenas
 * em `refresh_tokens` — desativar usuário, resetar senha, excluir usuário,
 * bloquear ou excluir empresa, estorno/chargeback, troca de senha. O access
 * token continuava autorizando ESCRITA por até 15 minutos.
 *
 * O caso concreto: o super-admin exclui um funcionário demitido às 10:00, e até
 * as 10:15 o JWT dele ainda registra venda e recebe fiado. E a tela de
 * redefinição de senha promete o contrário, com todas as letras: "todos os
 * dispositivos conectados serão desconectados".
 */

const tenants: string[] = [];
let tenantId = "";
let userId = "";
let outroUserId = "";

const email = (p: string) =>
  `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@teste.com`;

beforeAll(async () => {
  tenantId = await createTestTenant("REVOGACAO");
  tenants.push(tenantId);
  const [a, b] = await Promise.all([
    prisma.user.create({
      data: { tenantId, name: "Dono", email: email("dono"), passwordHash: "x", role: "OWNER" },
    }),
    prisma.user.create({
      data: { tenantId, name: "Outro", email: email("outro"), passwordHash: "x", role: "OWNER" },
    }),
  ]);
  userId = a.id;
  outroUserId = b.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

const sessaoDe = async (id: string) => {
  const payload = await buildAccessPayload(id);
  if (!payload) throw new Error("payload nulo");
  return payload;
};

describe("o access token deixa de valer na hora", () => {
  it("revogar as sessões do usuário invalida a sessão já emitida", async () => {
    const antes = await sessaoDe(userId);
    // Controle: enquanto nada mudou, ela vale.
    await expect(assertSessaoValida(antes)).resolves.toBeUndefined();

    await revokeAllForUser(userId, "PASSWORD");

    await expect(assertSessaoValida(antes)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("a sessão reemitida DEPOIS da revogação vale", async () => {
    // Prova que a ordem dos call sites está certa: `change-password` e o login
    // com Google revogam e só então constroem o payload novo.
    await revokeAllForUser(userId, "PASSWORD");
    const depois = await sessaoDe(userId);
    await expect(assertSessaoValida(depois)).resolves.toBeUndefined();
  });

  it("bloquear a empresa derruba a sessão de OUTRO usuário dela", async () => {
    // É o que o `tev` cobre: estorno e chargeback revogam por empresa, não por
    // usuário, e antes só mexiam em refresh_tokens.
    const sessao = await sessaoDe(outroUserId);
    await expect(assertSessaoValida(sessao)).resolves.toBeUndefined();

    await revokeAllForTenant(tenantId);

    await expect(assertSessaoValida(sessao)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("usuário desativado não passa, mesmo com o epoch em dia", async () => {
    const sessao = await sessaoDe(outroUserId);
    await prisma.user.update({ where: { id: outroUserId }, data: { active: false } });
    await expect(assertSessaoValida(sessao)).rejects.toBeInstanceOf(UnauthorizedError);
    await prisma.user.update({ where: { id: outroUserId }, data: { active: true } });
  });

  it("usuário excluído não passa", async () => {
    const sessao = await sessaoDe(outroUserId);
    await prisma.user.update({ where: { id: outroUserId }, data: { deletedAt: new Date() } });
    await expect(assertSessaoValida(sessao)).rejects.toBeInstanceOf(UnauthorizedError);
    await prisma.user.update({ where: { id: outroUserId }, data: { deletedAt: null } });
  });
});

describe("token sem os claims novos", () => {
  it("vale enquanto o epoch estiver em zero, e cai no primeiro incremento", async () => {
    // Um token emitido antes desta mudança não tem `sev`/`tev`. Tratá-lo como
    // zero — o default das colunas — deixa a transição sem derrubar ninguém, e
    // a cauda é curta: qualquer revogação o invalida.
    const base = await sessaoDe(userId);
    const legado = { ...base, sev: undefined, tev: undefined };

    await prisma.user.update({ where: { id: userId }, data: { sessionEpoch: 0 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { sessionEpoch: 0 } });
    await expect(assertSessaoValida(legado)).resolves.toBeUndefined();

    await revokeAllForUser(userId, "ADMIN");
    await expect(assertSessaoValida(legado)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
