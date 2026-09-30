import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PWA_SNAPSHOT_SCHEMA_VERSION, type PwaSnapshot } from "@/lib/pwa/snapshot";

/**
 * Tela de consulta offline.
 *
 * A versão congelada no precache do SW quebrava quando `avisos[].total` passou a
 * poder ser `null` (aviso que não é sobre dinheiro). A versão de formato do
 * snapshot barra o registro estranho no `offline-store`; aqui se prova a segunda
 * rede: aviso sem valor (nulo OU ausente) mostra o rótulo sem número, e a tela
 * não cai.
 */

const carregarSnapshot = vi.fn();
vi.mock("@/lib/pwa/offline-store", () => ({
  carregarSnapshot: () => carregarSnapshot(),
  idadeEmMinutos: () => 5,
}));

const { ConsultaOfflineClient } = await import(
  "@/app/consulta-offline/_components/consulta-client"
);

function snapshot(avisos: unknown[]): PwaSnapshot {
  return {
    schemaVersion: PWA_SNAPSHOT_SCHEMA_VERSION,
    cachedAt: "2026-09-30T12:00:00.000Z",
    empresa: { nome: "Box 1" },
    resumo: { hojeVendi: 10, aReceber: 20, estoqueValor: 30, contasPagar: 0 },
    avisos: avisos as PwaSnapshot["avisos"],
    estoque: [{ productId: "p1", name: "Tomate", saleUnit: "CX", quantity: 3, value: 90 }],
    fiado: [],
    totais: { fiadoEmAberto: 0, caixasComClientes: 0 },
  };
}

beforeEach(() => carregarSnapshot.mockReset());

describe("ConsultaOfflineClient", () => {
  it("aviso com total nulo ou ausente: rótulo sem valor, sem derrubar a tela", async () => {
    carregarSnapshot.mockResolvedValue(
      snapshot([
        { tipo: "higienizacao", label: "2 envios sem devolução", count: 2, total: null, href: "/h" },
        { tipo: "antigo", label: "Aviso sem campo total", count: 1, href: "/x" },
        { tipo: "fiado", label: "3 fiados vencidos", count: 3, total: 150, href: "/fiado" },
      ]),
    );
    render(<ConsultaOfflineClient />);

    expect(await screen.findByText("2 envios sem devolução")).toBeInTheDocument();
    expect(screen.getByText("Aviso sem campo total")).toBeInTheDocument();
    const linhaFiado = screen.getByText("3 fiados vencidos").parentElement!;
    expect(linhaFiado).toHaveTextContent(/150,00/);
    // Nulo não vira "R$ 0,00": zero seria afirmar um valor que o aviso não tem.
    expect(screen.getByText("2 envios sem devolução").parentElement).not.toHaveTextContent("R$");
    expect(screen.getByText("Tomate")).toBeInTheDocument();
  });

  it("sem snapshot legível (formato de outro build já descartado): estado vazio normal", async () => {
    carregarSnapshot.mockResolvedValue(null);
    render(<ConsultaOfflineClient />);
    expect(await screen.findByText("Nenhum dado salvo neste aparelho")).toBeInTheDocument();
  });
});
