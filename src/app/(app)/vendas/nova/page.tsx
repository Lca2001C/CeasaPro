import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { VendasService } from "@/lib/services/vendas.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { Pdv } from "./_components/pdv";

export const dynamic = "force-dynamic";

export default async function NovaVendaPage({
  searchParams,
}: {
  /** `?produto=<id>` — atalho "Vender" da tela de Estoque. */
  searchParams: Promise<{ produto?: string }>;
}) {
  const { produto: produtoInicial } = await searchParams;
  const { tenantId } = await requireTenant();
  const [produtos, saldo, ultimosPrecos, clientesConhecidos, posicoes] = await Promise.all([
    ProdutosService.list(tenantId),
    CaixasService.getSaldo(tenantId),
    VendasService.ultimosPrecos(tenantId),
    VendasService.clientesConhecidos(tenantId),
    EstoqueService.getPositions(tenantId),
  ]);

  // O saldo vai como número simples: o PDV só precisa comparar e mostrar, e
  // Decimal não atravessa a fronteira Server → Client component.
  const estoquePorProduto: Record<string, number> = {};
  for (const p of posicoes) estoquePorProduto[p.productId] = Number(p.quantity);

  const ativos = produtos
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: p.name, saleUnit: p.saleUnit }));

  return (
    <Pdv
      produtos={ativos}
      caixasLimpas={saldo.limpas}
      ultimosPrecos={ultimosPrecos}
      clientesConhecidos={clientesConhecidos}
      estoquePorProduto={estoquePorProduto}
      produtoInicial={produtoInicial}
    />
  );
}
