import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { AdminService } from "@/lib/services/admin.service";
import { NotFoundError } from "@/lib/http/app-error";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import type { AdminCtx } from "@/lib/http/with-action";

// Contexto de super-admin (o service só usa userId, session.email e ip).
const adminCtx: AdminCtx = {
  userId: "admin-test",
  ip: null,
  session: {
    sub: "admin-test",
    role: "SUPER_ADMIN",
    tenantId: null,
    email: "admin@ceasapro.com.br",
    name: "Admin",
    mustChangePassword: false,
    tenantStatus: null,
    subStatus: null,
  },
};

let tenantId = "";

beforeAll(async () => {
  tenantId = await createTestTenant("EXCLUIR EMPRESA");
});

afterAll(async () => {
  await cleanupTenants([tenantId]);
});

describe("Excluir empresa (soft-delete) — admin", () => {
  it("marca deletedAt + status BLOCKED e registra auditoria DELETE", async () => {
    const res = await AdminService.deleteTenant(tenantId, adminCtx);
    expect(res.id).toBe(tenantId);

    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t?.deletedAt).toBeTruthy();
    expect(t?.status).toBe("BLOCKED");

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, entity: "Tenant", action: "DELETE" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toBeTruthy();
  });

  it("some de listTenants()", async () => {
    const list = await AdminService.listTenants();
    expect(list.find((t) => t.id === tenantId)).toBeUndefined();
  });

  it("getTenant() de empresa excluída lança NotFoundError", async () => {
    await expect(AdminService.getTenant(tenantId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("é idempotente (excluir de novo não quebra)", async () => {
    const res = await AdminService.deleteTenant(tenantId, adminCtx);
    expect(res.id).toBe(tenantId);
  });

  it("empresa inexistente lança NotFoundError", async () => {
    await expect(AdminService.deleteTenant("nao-existe", adminCtx)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
