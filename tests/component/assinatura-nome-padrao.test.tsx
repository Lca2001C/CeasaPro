import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NOME_EMPRESA_PADRAO } from "@/lib/tenant-defaults";

/**
 * O aviso "é esse nome que vai no comprovante" oferecia "Ajustar em
 * Configurações" também para a empresa BLOQUEADA — e /configuracoes não é
 * billing-safe: o proxy a mandava para /conta/suspensa. É justamente a empresa
 * que nunca pagou (trial vencido) quem mais vê esse aviso.
 */
const sessao = vi.hoisted(() => ({
  atual: { tenantStatus: "ACTIVE", subStatus: "SUSPENSO", email: "d@x.com" } as Record<
    string,
    unknown
  >,
}));
vi.mock("@/lib/auth/session", () => ({
  requireTenant: async () => ({ session: sessao.atual, tenantId: "t1" }),
}));
vi.mock("@/lib/services/billing.service", () => ({
  BillingService: {
    mpConfigured: () => true,
    getStatus: async () => ({
      sub: {
        status: sessao.atual.subStatus,
        activatedAt: null,
        cancelledAt: null,
        monthlyAmount: 99,
        currentPeriodEnd: new Date(),
        tenant: { tradeName: "Minha empresa", termsVersion: null },
      },
      pendingCharge: null,
      paidCharge: null,
      refMonth: "2026-09",
    }),
  },
}));
vi.mock("@/lib/services/plano.service", () => ({
  PlanoService: { listAvailablePlans: async () => [] },
}));
vi.mock("@/app/assinatura/_components/assinatura-client", () => ({
  AssinaturaClient: () => null,
}));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}));

const { default: AssinaturaPage } = await import("@/app/assinatura/page");

describe("/assinatura com o nome de partida", () => {
  it("bloqueada: não manda para /configuracoes (cairia em /conta/suspensa)", async () => {
    sessao.atual = { tenantStatus: "ACTIVE", subStatus: "SUSPENSO", email: "d@x.com" };
    render(await AssinaturaPage());
    expect(screen.getByText(NOME_EMPRESA_PADRAO)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Configurações/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Depois que o pagamento for aprovado/)).toBeInTheDocument();
  });

  it("com acesso: continua oferecendo o atalho", async () => {
    sessao.atual = { tenantStatus: "ACTIVE", subStatus: "TRIAL", email: "d@x.com" };
    render(await AssinaturaPage());
    expect(screen.getByRole("link", { name: /Configurações/ })).toHaveAttribute(
      "href",
      "/configuracoes",
    );
  });
});
