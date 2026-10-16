import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
import { ComprasService } from "@/lib/services/compras.service";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { isModuleEnabled } from "@/lib/plan/modules";
import { r2Configurado } from "@/lib/storage/r2";
import { PageHeader } from "@/components/data/page-header";
import { CompraForm } from "./_components/compra-form";

export const dynamic = "force-dynamic";

/**
 * Registrar compra — dentro do Estoque. A compra dá entrada no estoque (custo
 * com frete rateado) e lança a conta dela em Despesas, com o fornecedor.
 */
export default async function NovaCompraPage() {
  const { tenantId, session } = await requireTenant();
  const [produtos, fornecedores, ultimosPagos, boletim] = await Promise.all([
    ProdutosService.list(tenantId),
    FornecedoresService.list(tenantId),
    ComprasService.ultimosPrecosPagos(tenantId),
    /*
      Cotações é módulo PAGO e esta tela é de NÚCLEO — o gate de rota não passa
      por aqui. Mesmo padrão do Início: sem isto, quem não contratou veria preço
      de boletim numa tela que ele tem direito de usar. `isModuleEnabled` é
      fail-closed, então o custo de esquecer seria mostrar demais, nunca de menos.
    */
    isModuleEnabled(session.modules, "cotacoes")
      ? CotacoesService.precosDoBoletimPorProduto(tenantId)
      : Promise.resolve({}),
  ]);
  return (
    <div>
      <PageHeader
        title="Registrar compra"
        description="O estoque sobe e a conta vai para Despesas, com o fornecedor."
      />
      <CompraForm
        produtos={produtos.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))}
        fornecedores={fornecedores
          .filter((f) => f.active)
          .map((f) => ({ id: f.id, name: f.name }))}
        ultimosPagos={ultimosPagos}
        boletim={boletim}
        // Mesmo gate do servidor (`ComprasService.registrarCompra`): sem o
        // módulo, a compra não registra caixas e a tela não oferece o campo.
        caixasHabilitado={isModuleEnabled(session.modules, "caixas")}
        fotosDisponiveis={r2Configurado()}
      />
    </div>
  );
}
