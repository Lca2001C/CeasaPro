import { requireTenant } from "@/lib/auth/session";
import { CaixasService } from "@/lib/services/caixas.service";
import { VendasService } from "@/lib/services/vendas.service";
import { caixaMovimentoTipoEnum } from "@/lib/validations/caixa";
import { PageHeader } from "@/components/data/page-header";
import { MovimentoCaixaForm } from "./_components/movimento-form";

export const dynamic = "force-dynamic";

/**
 * Cada situação do balcão tem seu título — quem chega pelo atalho "Cliente
 * devolveu" não deveria ler "Movimentar caixas: entrada, saída, retorno,
 * higienização ou quebra" e ter de traduzir para o próprio caso.
 */
const TITULOS: Record<string, { titulo: string; descricao: string }> = {
  ENTRADA: {
    titulo: "Recebi caixas",
    descricao: "Chegaram caixas plásticas — de compra, de fornecedor ou devolvidas em lote.",
  },
  SAIDA: {
    titulo: "Caixas saíram com o cliente",
    descricao: "Registre as caixas que foram junto com a mercadoria.",
  },
  RETORNO: {
    titulo: "Cliente devolveu caixas",
    descricao: "As caixas voltam para o estoque como sujas, prontas para higienizar.",
  },
  QUEBRA: {
    titulo: "Registrar perda",
    descricao: "Caixa quebrada ou sumida — no seu estoque, com o cliente ou no higienizador.",
  },
  SAIDA_HIGIENIZACAO: {
    titulo: "Enviar para higienização",
    descricao: "As caixas sujas saem para o higienizador.",
  },
  RETORNO_HIGIENIZACAO: {
    titulo: "Caixas voltaram da higienização",
    descricao: "As caixas voltam limpas e prontas para vender.",
  },
};

export default async function NovoMovimentoCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{
    tipo?: string;
    qtd?: string;
    cliente?: string;
    higienizador?: string;
  }>;
}) {
  const { tipo, qtd, cliente, higienizador } = await searchParams;
  const { tenantId } = await requireTenant();
  const [saldo, clientesConhecidos] = await Promise.all([
    CaixasService.getSaldo(tenantId),
    VendasService.clientesConhecidos(tenantId),
  ]);

  const tipoInicial = caixaMovimentoTipoEnum.safeParse(tipo).data;
  const texto = (tipoInicial && TITULOS[tipoInicial]) ?? {
    titulo: "Movimentar caixas",
    descricao: "Entrada, saída para cliente, retorno, higienização ou quebra.",
  };

  return (
    <div>
      <PageHeader title={texto.titulo} description={texto.descricao} />
      <MovimentoCaixaForm
        saldo={saldo}
        tipoInicial={tipoInicial}
        quantidadeInicial={qtd}
        clienteInicial={cliente}
        higienizadorInicial={higienizador}
        clientesConhecidos={clientesConhecidos}
      />
    </div>
  );
}
