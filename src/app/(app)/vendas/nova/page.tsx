import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { VendasService } from "@/lib/services/vendas.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { isModuleEnabled } from "@/lib/plan/modules";
import { Pdv } from "./_components/pdv";

export const dynamic = "force-dynamic";

export default async function NovaVendaPage({
  searchParams,
}: {
  /** `?produto=<id>` — atalho "Vender" da tela de Estoque. */
  searchParams: Promise<{ produto?: string }>;
}) {
  const { produto: produtoInicial } = await searchParams;
  const { tenantId, session } = await requireTenant();
  const caixasHabilitado = isModuleEnabled(session.modules, "caixas");

  const [
    produtos,
    saldo,
    ultimosPrecos,
    precosDaCompra,
    maisVendidos,
    clientesConhecidos,
    posicoes,
    ultimaVenda,
  ] = await Promise.all([
    ProdutosService.list(tenantId),
    // Sem o módulo de caixas o saldo não é lido: nada na tela usa.
    caixasHabilitado
      ? CaixasService.getSaldo(tenantId)
      : Promise.resolve({ limpas: 0 } as { limpas: number }),
    VendasService.ultimosPrecos(tenantId),
    VendasService.precosSugeridosDaCompra(tenantId),
    VendasService.maisVendidos(tenantId),
    VendasService.clientesConhecidos(tenantId),
    EstoqueService.getPositions(tenantId),
    VendasService.ultimaVenda(tenantId),
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
      caixasHabilitado={caixasHabilitado}
      ultimosPrecos={ultimosPrecos}
      precosDaCompra={precosDaCompra}
      maisVendidos={maisVendidos}
      clientesConhecidos={clientesConhecidos}
      estoquePorProduto={estoquePorProduto}
      produtoInicial={produtoInicial}
      ultimaVenda={
        ultimaVenda
          ? { customerName: ultimaVenda.customerName, itens: ultimaVenda.itens }
          : null
      }
    />
  );
}
