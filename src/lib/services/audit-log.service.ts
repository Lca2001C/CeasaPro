import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export interface AuditLogFilters {
  action?: string;
  entity?: string;
  actorEmail?: string;
  tenantId?: string;
}

export interface AuditLogRow {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  userId: string | null;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ip: string | null;
  createdAt: Date;
}

const TAKE = 100;

export const AuditLogService = {
  async listForTenant(tenantId: string, filters: AuditLogFilters = {}) {
    const rows = await prisma.auditLog.findMany({
      where: buildWhere({ ...filters, tenantId }),
      select: auditSelect,
      orderBy: { createdAt: "desc" },
      take: TAKE,
    });
    return rows.map((row) => ({ ...row, tenantName: null }));
  },

  async listForAdmin(filters: AuditLogFilters = {}) {
    const rows = await prisma.auditLog.findMany({
      where: buildWhere(filters),
      select: auditSelect,
      orderBy: { createdAt: "desc" },
      take: TAKE,
    });
    const tenantIds = [...new Set(rows.map((row) => row.tenantId).filter(Boolean))] as string[];
    const tenants = tenantIds.length
      ? await prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, tradeName: true },
        })
      : [];
    const tenantName = new Map(tenants.map((tenant) => [tenant.id, tenant.tradeName]));
    return rows.map((row) => ({
      ...row,
      tenantName: row.tenantId ? tenantName.get(row.tenantId) ?? null : null,
    }));
  },
};

const auditSelect = {
  id: true,
  tenantId: true,
  userId: true,
  actorEmail: true,
  action: true,
  entity: true,
  entityId: true,
  ip: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

function buildWhere(filters: AuditLogFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  const tenantId = clean(filters.tenantId);
  const action = clean(filters.action)?.toUpperCase();
  const entity = clean(filters.entity);
  const actorEmail = clean(filters.actorEmail);

  if (tenantId) where.tenantId = tenantId;
  if (action) where.action = action;
  if (entity) where.entity = { contains: entity, mode: "insensitive" };
  if (actorEmail) where.actorEmail = { contains: actorEmail, mode: "insensitive" };

  return where;
}

function clean(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 120);
}
