import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { PushInscricaoService } from "@/lib/services/push-inscricao.service";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Inscrição de push por aparelho.
 *
 * Os dois casos que importam aqui falham em silêncio se quebrarem — nenhum erro
 * aparece, o usuário só passa a receber errado:
 *
 * 1. reinscrever o mesmo aparelho tem de ATUALIZAR a linha, não criar outra
 *    (senão cada notificação chega duplicada);
 * 2. remover só pode alcançar a inscrição de quem pediu (senão conhecer um
 *    endpoint alheio desliga os avisos de outra pessoa).
 */

const uniq = () => Math.random().toString(36).slice(2, 10);
const tenants: string[] = [];

/** Formato realista: os endpoints do FCM têm esta cara. */
const endpointDe = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`;

const chaves = (marca: string) => ({ p256dh: `p256dh-${marca}`, auth: `auth-${marca}` });

let tenantA = "";
let tenantB = "";
let userA1 = "";
let userA2 = "";
let userB1 = "";

async function criarUsuario(tenantId: string, nome: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      tenantId,
      name: nome,
      email: `push-${uniq()}@teste.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  return u.id;
}

beforeAll(async () => {
  tenantA = await createTestTenant("PUSH A");
  tenantB = await createTestTenant("PUSH B");
  tenants.push(tenantA, tenantB);
  userA1 = await criarUsuario(tenantA, "Dono A1");
  userA2 = await criarUsuario(tenantA, "Dono A2");
  userB1 = await criarUsuario(tenantB, "Dono B1");
});

afterAll(async () => {
  // As inscrições caem por cascata (tenant → user → pushSubscription), mas
  // apagar explicitamente evita deixar lixo se o cascade mudar de ideia.
  await prisma.pushSubscription.deleteMany({ where: { tenantId: { in: tenants } } });
  await cleanupTenants(tenants);
});

describe("PushInscricaoService.registrar", () => {
  it("grava a inscrição com dono, chaves e user-agent", async () => {
    const endpoint = endpointDe(uniq());
    await PushInscricaoService.registrar(
      { userId: userA1, tenantId: tenantA },
      { endpoint, keys: chaves("v1") },
      "Mozilla/5.0 (Linux; Android 14)",
    );

    const linha = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(linha).toMatchObject({
      userId: userA1,
      tenantId: tenantA,
      p256dh: "p256dh-v1",
      auth: "auth-v1",
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
      lastSentAt: null,
    });
  });

  it("reinscrever o MESMO endpoint atualiza a linha em vez de duplicar", async () => {
    const endpoint = endpointDe(uniq());
    const dono = { userId: userA1, tenantId: tenantA };

    await PushInscricaoService.registrar(dono, { endpoint, keys: chaves("v1") }, null);
    await PushInscricaoService.registrar(dono, { endpoint, keys: chaves("v2") }, null);
    await PushInscricaoService.registrar(dono, { endpoint, keys: chaves("v3") }, null);

    const linhas = await prisma.pushSubscription.findMany({ where: { endpoint } });
    expect(linhas).toHaveLength(1);
    // A última rotação de chaves é a que vale: enviar com a antiga falharia na
    // descriptografia no aparelho.
    expect(linhas[0]!.p256dh).toBe("p256dh-v3");
    expect(linhas[0]!.auth).toBe("auth-v3");
  });

  it("celular compartilhado: o endpoint passa a pertencer a quem logou agora", async () => {
    const endpoint = endpointDe(uniq());

    await PushInscricaoService.registrar(
      { userId: userB1, tenantId: tenantB },
      { endpoint, keys: chaves("b") },
      null,
    );
    await PushInscricaoService.registrar(
      { userId: userA2, tenantId: tenantA },
      { endpoint, keys: chaves("a") },
      null,
    );

    const linha = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(linha.userId).toBe(userA2);
    // O tenantId acompanha: é o que decide de qual empresa vêm os números na
    // notificação. Ficar no tenant anterior seria vazamento entre empresas.
    expect(linha.tenantId).toBe(tenantA);

    // E o dono anterior não tem mais nada apontando para este aparelho.
    const doAntigo = await prisma.pushSubscription.count({
      where: { userId: userB1, endpoint },
    });
    expect(doAntigo).toBe(0);
  });

  it("um usuário pode ter vários aparelhos", async () => {
    const celular = endpointDe(uniq());
    const desktop = endpointDe(uniq());
    const dono = { userId: userA2, tenantId: tenantA };

    await PushInscricaoService.registrar(dono, { endpoint: celular, keys: chaves("c") }, "Android");
    await PushInscricaoService.registrar(dono, { endpoint: desktop, keys: chaves("d") }, "Windows");

    const endpoints = await prisma.pushSubscription.findMany({
      where: { userId: userA2, endpoint: { in: [celular, desktop] } },
      select: { endpoint: true },
    });
    expect(endpoints).toHaveLength(2);
  });
});

describe("PushInscricaoService.remover", () => {
  it("remove a própria inscrição", async () => {
    const endpoint = endpointDe(uniq());
    await PushInscricaoService.registrar(
      { userId: userA1, tenantId: tenantA },
      { endpoint, keys: chaves("x") },
      null,
    );

    const r = await PushInscricaoService.remover({ userId: userA1 }, { endpoint });
    expect(r.removidas).toBe(1);
    expect(await prisma.pushSubscription.findUnique({ where: { endpoint } })).toBeNull();
  });

  it("não remove a inscrição de outro usuário, nem da mesma empresa", async () => {
    const endpoint = endpointDe(uniq());
    await PushInscricaoService.registrar(
      { userId: userA1, tenantId: tenantA },
      { endpoint, keys: chaves("y") },
      null,
    );

    // Mesma empresa, outro usuário: o endpoint é conhecido, mas não é dele.
    const vizinho = await PushInscricaoService.remover({ userId: userA2 }, { endpoint });
    expect(vizinho.removidas).toBe(0);

    // Outra empresa: idem.
    const estranho = await PushInscricaoService.remover({ userId: userB1 }, { endpoint });
    expect(estranho.removidas).toBe(0);

    expect(await prisma.pushSubscription.findUnique({ where: { endpoint } })).not.toBeNull();
  });

  it("endpoint inexistente não é erro (remover é idempotente)", async () => {
    const r = await PushInscricaoService.remover(
      { userId: userA1 },
      { endpoint: endpointDe("nunca-existiu") },
    );
    expect(r.removidas).toBe(0);
  });
});
