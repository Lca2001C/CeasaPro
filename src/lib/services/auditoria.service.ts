import { prisma } from "@/lib/db/prisma";

/**
 * Consulta da trilha de auditoria. AuditLog não passa pela extensão de tenant
 * (é append-only via prisma base), então o filtro por tenantId é explícito aqui.
 */
export const AuditoriaService = {
  /** Atividades da empresa (para o OWNER). */
  async listForTenant(tenantId: string, entity?: string) {
    return prisma.auditLog.findMany({
      where: { tenantId, ...(entity ? { entity } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  },

  /** Atividades globais (para o super-admin), com nome da empresa. */
  async listGlobal(entity?: string) {
    const logs = await prisma.auditLog.findMany({
      where: entity ? { entity } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const tenantIds = [...new Set(logs.map((l) => l.tenantId).filter(Boolean))] as string[];
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, tradeName: true },
    });
    const names = new Map(tenants.map((t) => [t.id, t.tradeName]));
    return logs.map((l) => ({
      ...l,
      tenantName: l.tenantId ? (names.get(l.tenantId) ?? "—") : "Plataforma",
    }));
  },

  /** Entidades distintas registradas (para o filtro). */
  async listEntities(tenantId?: string) {
    const rows = await prisma.auditLog.findMany({
      where: tenantId ? { tenantId } : undefined,
      select: { entity: true },
      distinct: ["entity"],
      orderBy: { entity: "asc" },
    });
    return rows.map((r) => r.entity);
  },
};
