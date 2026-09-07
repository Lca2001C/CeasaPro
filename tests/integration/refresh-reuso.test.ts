import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  hashToken,
} from "@/lib/auth/refresh";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Reuso de refresh token.
 *
 * `rotateRefreshToken` devolvia `null` para um token já revogado, e os
 * chamadores só limpavam cookies — a família nunca era revogada. Quem copiasse
 * o cookie (aparelho compartilhado, backup de perfil do navegador, malware)
 * rotacionava uma vez e ficava com uma cadeia nova de 30 dias; a vítima, ao
 * voltar, apresentava o token que o atacante já queimou, recebia `null` e era
 * DESLOGADA. Nada era auditado, e o atacante seguia dentro.
 *
 * O código já sabia da lacuna: `purgeDeadRefreshTokens` guarda as linhas
 * revogadas por 7 dias porque "a linha revogada é a evidência de reuso" — e
 * nenhum ponto do código a consultava.
 *
 * Metade destes casos existe para provar que ninguém LEGÍTIMO cai: duas abas
 * renovam concorrentemente, e uma resposta perdida faz o cliente reenviar com o
 * cookie antigo. Um desenho que desloga usuário legítimo é pior que o bug.
 */

const tenants: string[] = [];
let userId = "";

beforeAll(async () => {
  const tenantId = await createTestTenant("REUSO");
  tenants.push(tenantId);
  const user = await prisma.user.create({
    data: {
      tenantId,
      name: "Dono Reuso",
      email: `reuso-${Date.now()}-${Math.random().toString(36).slice(2)}@teste.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

/** Empurra a revogação para o passado, para sair da janela de graça. */
async function envelheceRevogacao(raw: string, minutos = 5) {
  await prisma.refreshToken.update({
    where: { tokenHash: hashToken(raw) },
    data: { revokedAt: new Date(Date.now() - minutos * 60_000) },
  });
}

describe("token roubado reapresentado", () => {
  it("revoga a família inteira e derruba também o sucessor do atacante", async () => {
    const original = await createRefreshToken(userId);
    const rotacionado = await rotateRefreshToken(original);
    expect(rotacionado.tipo).toBe("ok");
    const sucessor = rotacionado.tipo === "ok" ? rotacionado.newToken : "";

    await envelheceRevogacao(original);

    const reuso = await rotateRefreshToken(original);
    expect(reuso.tipo).toBe("reuso");

    // A família toda cai — inclusive o token que a rotação legítima emitiu.
    const familyId = (
      await prisma.refreshToken.findFirstOrThrow({ where: { tokenHash: hashToken(original) } })
    ).familyId;
    const vivos = await prisma.refreshToken.count({
      where: { familyId, revokedAt: null },
    });
    expect(vivos).toBe(0);
    expect((await rotateRefreshToken(sucessor)).tipo).not.toBe("ok");
  });

  it("registra o reuso na auditoria, com os dois endereços", async () => {
    const { auditarReusoDeSessao } = await import("@/lib/auth/refresh");
    const original = await createRefreshToken(userId, { ip: "203.0.113.7" });
    const familyId = (
      await prisma.refreshToken.findFirstOrThrow({ where: { tokenHash: hashToken(original) } })
    ).familyId;

    await auditarReusoDeSessao(userId, familyId, { ip: "198.51.100.9" });

    const log = await prisma.auditLog.findFirst({
      where: { action: "SESSION_REUSE_DETECTED", entityId: familyId },
    });
    expect(log).not.toBeNull();
    const dados = log!.newData as Record<string, unknown>;
    expect(dados.ipApresentacao).toBe("198.51.100.9");
    expect(dados.ipDaSessaoOriginal).toBe("203.0.113.7");
  });
});

describe("ninguém legítimo é derrubado", () => {
  it("a corrida de duas abas recebe token usável e não revoga nada", async () => {
    const original = await createRefreshToken(userId);
    const primeira = await rotateRefreshToken(original);
    expect(primeira.tipo).toBe("ok");

    // Sem envelhecer: é o mesmo instante, como em duas abas concorrentes.
    const segunda = await rotateRefreshToken(original);
    expect(segunda.tipo).toBe("corrida");
    expect(segunda.tipo === "corrida" && segunda.newToken).toBeTruthy();

    // E o token emitido pela PRIMEIRA continua funcionando.
    const sucessor = primeira.tipo === "ok" ? primeira.newToken : "";
    expect((await rotateRefreshToken(sucessor)).tipo).toBe("ok");
  });

  it("três renovações simultâneas resolvem todas, sem revogar a família", async () => {
    const original = await createRefreshToken(userId);
    const resultados = await Promise.all([
      rotateRefreshToken(original),
      rotateRefreshToken(original),
      rotateRefreshToken(original),
    ]);
    expect(resultados.every((r) => r.tipo === "ok" || r.tipo === "corrida")).toBe(true);
    expect(resultados.some((r) => r.tipo === "reuso")).toBe(false);
  });

  // A regressão mais provável de todas: se o logout não fosse distinguido da
  // rotação, todo "sair" viraria "ataque detectado".
  it("logout NÃO é tratado como reuso", async () => {
    const raw = await createRefreshToken(userId);
    await revokeRefreshToken(raw, "LOGOUT");
    await envelheceRevogacao(raw);

    const r = await rotateRefreshToken(raw);
    expect(r.tipo).toBe("invalido");

    const logs = await prisma.auditLog.count({
      where: { action: "SESSION_REUSE_DETECTED", userId },
    });
    // Nenhum log NOVO além do que o teste de auditoria criou de propósito.
    expect(logs).toBeLessThanOrEqual(1);
  });

  it("token desconhecido não escreve nada — fecha o DoS de terceiro", async () => {
    const antes = await prisma.refreshToken.count();
    const r = await rotateRefreshToken("token-que-nunca-existiu");
    expect(r.tipo).toBe("invalido");
    expect(await prisma.refreshToken.count()).toBe(antes);
  });

  it("a janela de graça é finita", async () => {
    const original = await createRefreshToken(userId);
    await rotateRefreshToken(original);
    // Esgota os usos de graça permitidos.
    await rotateRefreshToken(original);
    await rotateRefreshToken(original);
    await rotateRefreshToken(original);
    const excedente = await rotateRefreshToken(original);
    expect(excedente.tipo).toBe("reuso");
  });
});
