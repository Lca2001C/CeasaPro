import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { VendasService } from "@/lib/services/vendas.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { ComprasService } from "@/lib/services/compras.service";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { isModuleEnabled } from "@/lib/plan/modules";
import { publicUrl } from "@/lib/storage/r2";
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
    ultimasCompras,
    maisVendidos,
    clientesConhecidos,
    saldoPorProduto,
    ultimaVenda,
    boletim,
  ] = await Promise.all([
    ProdutosService.ativosParaVenda(tenantId),
    // Sem o módulo de caixas o saldo não é lido: nada na tela usa.
    caixasHabilitado
      ? CaixasService.getSaldo(tenantId)
      : Promise.resolve({ limpas: 0 } as { limpas: number }),
    VendasService.ultimosPrecos(tenantId),
    // Uma leitura das compras para os dois números que saem dela (ver abaixo).
    ComprasService.ultimaCompraPorProduto(tenantId),
    VendasService.maisVendidos(tenantId),
    VendasService.clientesConhecidos(tenantId),
    // Só o saldo: o custo médio (janela sobre o livro-razão) não aparece aqui.
    EstoqueService.getQuantidades(tenantId),
    VendasService.ultimaVenda(tenantId),
    // Mesma regra do saldo de caixas acima: quem não contratou Cotações não paga
    // a consulta, e o PDV — a tela mais sensível a latência do sistema — não
    // ganha uma ida ao banco por um bloco que não vai renderizar.
    isModuleEnabled(session.modules, "cotacoes")
      ? CotacoesService.precosDoBoletimPorProduto(tenantId)
      : Promise.resolve({}),
  ]);

  const [precosDaCompra, ultimosPagos] = await Promise.all([
    VendasService.precosSugeridosDaCompra(tenantId, ultimasCompras),
    ComprasService.ultimosPrecosPagos(tenantId, ultimasCompras),
  ]);

  // O saldo vai como número simples: o PDV só precisa comparar e mostrar, e
  // Decimal não atravessa a fronteira Server → Client component.
  const estoquePorProduto: Record<string, number> = {};
  for (const p of produtos) estoquePorProduto[p.id] = saldoPorProduto[p.id] ?? 0;

  const ativos = produtos.map((p) => ({
      id: p.id,
      name: p.name,
      saleUnit: p.saleUnit,
      minStock: p.minStock == null ? null : Number(p.minStock),
      imageUrl: publicUrl(p.imageKey),
    }));

  // Preço de venda cadastrado no produto vence o sugerido pela compra, mas não
  // o da última venda: no CEASA o preço muda todo dia, e o último praticado é
  // mais atual que o do cadastro. A ordem final fica em `precoSugerido` (pdv).
  const precosSugeridos: Record<string, number> = { ...precosDaCompra };
  for (const p of produtos) {
    const preco = p.salePrice == null ? 0 : Number(p.salePrice);
    if (preco > 0) precosSugeridos[p.id] = preco;
  }

  return (
    <Pdv
      produtos={ativos}
      caixasLimpas={saldo.limpas}
      caixasHabilitado={caixasHabilitado}
      ultimosPrecos={ultimosPrecos}
      precosDaCompra={precosSugeridos}
      maisVendidos={maisVendidos}
      clientesConhecidos={clientesConhecidos}
      estoquePorProduto={estoquePorProduto}
      produtoInicial={produtoInicial}
      boletim={boletim}
      ultimosPagos={ultimosPagos}
      ultimaVenda={
        ultimaVenda
          ? { customerName: ultimaVenda.customerName, itens: ultimaVenda.itens }
          : null
      }
    />
  );
}
