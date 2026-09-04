import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TENANT_MODELS, SOFT_DELETE_MODELS } from "@/lib/db/models-tenant";

/**
 * Todo modelo com `tenantId` está protegido pela extensão de isolamento?
 *
 * `getTenantPrisma` injeta `where.tenantId` apenas nos modelos listados em
 * `TENANT_MODELS`. Um modelo com coluna `tenantId` que fique FORA da lista é
 * consultado sem filtro nenhum — e o furo é silencioso: o código compila, os
 * testes passam, e a primeira consulta que esquecer o `tenantId` à mão cruza
 * empresas.
 *
 * Foi exatamente o que aconteceu com `PackagingMovement`, achado na auditoria
 * anterior: tinha `tenantId`, era consultado via `getTenantPrisma` e estava
 * fora da lista. Nada vazou porque todas as chamadas passavam o `tenantId`
 * explicitamente — mas era uma linha de distância de vazar.
 *
 * Este teste transforma "alguém precisa lembrar" em "o CI reprova". Ler o
 * schema é o único jeito honesto de verificar: a lista é código, o schema é a
 * verdade, e só comparando os dois se percebe a divergência.
 */

const schema = readFileSync("prisma/schema.prisma", "utf8");

interface Modelo {
  nome: string;
  corpo: string;
}

const modelos: Modelo[] = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(
  (m) => ({ nome: m[1]!, corpo: m[2]! }),
);

const temCampo = (m: Modelo, re: RegExp) => re.test(m.corpo);
const comTenantId = modelos.filter((m) => temCampo(m, /^\s*tenantId\s+String/m));
const comDeletedAt = modelos.filter((m) => temCampo(m, /^\s*deletedAt\s+DateTime\?/m));

/**
 * Modelos de PLATAFORMA: têm `tenantId` mas são acessados pelo `prisma` cru, de
 * propósito, porque a operação não acontece dentro de uma empresa.
 *
 * Cada exceção precisa de motivo escrito. Acrescentar um nome aqui é uma
 * decisão de segurança, não um jeito de calar o teste — se o modelo for de
 * NEGÓCIO (o dono do box mexe nele pela tela), o lugar dele é `TENANT_MODELS`.
 */
const PLATAFORMA: Record<string, string> = {
  User: "login busca por e-mail sem saber o tenant ainda; super-admin não tem tenant",
  PushSubscription: "inscrição é do aparelho/usuário; o cron varre todas as empresas",
  TenantSubscription: "assinatura é da plataforma; webhook e cron agem sem sessão",
  SubscriptionPayment: "idem — o webhook do Mercado Pago chega sem sessão de empresa",
  AuditLog: "trilha imutável, sem relação nem cascade, para sobreviver ao soft delete do tenant",
  AdminNotification: "caixa de avisos do super-admin, fora de qualquer empresa",
};

describe("cobertura de models-tenant.ts", () => {
  it("o schema foi lido de verdade", () => {
    // Se o regex parar de casar (mudança de formatação do schema), o teste tem
    // de falhar em vez de passar por vacuidade.
    expect(modelos.length).toBeGreaterThan(20);
    expect(comTenantId.length).toBeGreaterThan(15);
  });

  it("todo modelo com tenantId está protegido ou é exceção declarada", () => {
    const desprotegidos = comTenantId
      .map((m) => m.nome)
      .filter((nome) => !TENANT_MODELS.has(nome) && !(nome in PLATAFORMA));

    expect(
      desprotegidos,
      "modelo com tenantId fora de TENANT_MODELS e sem justificativa em PLATAFORMA — " +
        "consultas nele não recebem filtro de empresa",
    ).toEqual([]);
  });

  it("nenhuma exceção de plataforma está também em TENANT_MODELS", () => {
    // As duas coisas ao mesmo tempo significa que a justificativa está obsoleta.
    const ambos = Object.keys(PLATAFORMA).filter((n) => TENANT_MODELS.has(n));
    expect(ambos, "está em TENANT_MODELS e ainda listado como plataforma").toEqual([]);
  });

  it("toda exceção de plataforma ainda existe no schema", () => {
    // Modelo renomeado/removido deixaria uma justificativa vigiando o vazio.
    const fantasmas = Object.keys(PLATAFORMA).filter(
      (n) => !modelos.some((m) => m.nome === n),
    );
    expect(fantasmas, "justificativa de plataforma para modelo inexistente").toEqual([]);
  });

  it("todo modelo protegido com deletedAt está em SOFT_DELETE_MODELS", () => {
    // Faltar aqui é o inverso do furo de isolamento: registro excluído volta a
    // aparecer nas listagens.
    const semSoftDelete = comDeletedAt
      .map((m) => m.nome)
      .filter((nome) => TENANT_MODELS.has(nome) && !SOFT_DELETE_MODELS.has(nome));

    expect(semSoftDelete, "tem deletedAt e está fora de SOFT_DELETE_MODELS").toEqual([]);
  });

  it("SOFT_DELETE_MODELS é subconjunto de TENANT_MODELS e todos têm deletedAt", () => {
    const foraDeTenant = [...SOFT_DELETE_MODELS].filter((n) => !TENANT_MODELS.has(n));
    expect(foraDeTenant, "em SOFT_DELETE_MODELS sem estar em TENANT_MODELS").toEqual([]);

    const semColuna = [...SOFT_DELETE_MODELS].filter(
      (n) => !comDeletedAt.some((m) => m.nome === n),
    );
    expect(semColuna, "em SOFT_DELETE_MODELS sem coluna deletedAt").toEqual([]);
  });

  it("nenhum nome em TENANT_MODELS aponta para modelo que não existe", () => {
    const fantasmas = [...TENANT_MODELS].filter((n) => !modelos.some((m) => m.nome === n));
    expect(fantasmas, "nome em TENANT_MODELS sem modelo correspondente").toEqual([]);
  });
});
