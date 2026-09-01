import { withTenantRoute } from "@/lib/http/with-route";
import { DashboardService } from "@/lib/services/dashboard.service";
import { AvisosService } from "@/lib/services/avisos.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { FiadoService } from "@/lib/services/fiado.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quantas linhas de cada lista vão para o snapshot. */
const LIMITE_ESTOQUE = 200;
const LIMITE_FIADO = 100;

/**
 * `GET /api/pwa/snapshot` — o que o app guarda para consultar sem rede.
 *
 * Três decisões que definem o formato:
 *
 * 1. **Números viram `number`, não `Decimal`.** `Prisma.Decimal` não sobrevive a
 *    JSON de forma útil, e a tela offline só EXIBE — não recalcula nada. Converter
 *    aqui evita carregar aritmética decimal para dentro do IndexedDB, onde ela não
 *    teria uso. Nenhuma soma é feita no cliente: os totais também vêm prontos.
 *
 * 2. **Listas limitadas.** O snapshot vai para o armazenamento do celular e o
 *    Safari descarta dados de sites pouco usados; um payload grande aumenta o
 *    custo e a chance de ser jogado fora. 200 produtos e 100 contas cobrem a
 *    consulta de balcão — quem tem mais que isso não vai rolar tudo sem rede.
 *
 * 3. **`cachedAt` é obrigatório.** Todo dado offline precisa carregar a hora em
 *    que foi buscado: número sem data faz o cliente decidir achando que está
 *    olhando o agora.
 */
export interface PwaSnapshot {
  cachedAt: string;
  empresa: { nome: string };
  resumo: {
    hojeVendi: number;
    aReceber: number;
    estoqueValor: number;
    contasPagar: number;
  };
  avisos: { tipo: string; label: string; count: number; total: number; href: string }[];
  estoque: {
    productId: string;
    name: string;
    saleUnit: string;
    quantity: number;
    value: number;
  }[];
  fiado: {
    id: string;
    cliente: string;
    saldo: number;
    dueDate: string | null;
    caixasComCliente: number;
  }[];
  totais: { fiadoEmAberto: number; caixasComClientes: number };
}

export const GET = withTenantRoute({
  handler: async (_input, ctx): Promise<PwaSnapshot> => {
    const [resumo, avisos, estoque, fiado] = await Promise.all([
      DashboardService.getSummary(ctx.tenantId),
      AvisosService.get(ctx.tenantId),
      EstoqueService.getPositions(ctx.tenantId),
      FiadoService.listOpen(ctx.tenantId, "EM_ABERTO"),
    ]);

    return {
      cachedAt: new Date().toISOString(),
      empresa: { nome: ctx.session.name },
      resumo: {
        hojeVendi: Number(resumo.hojeVendi),
        aReceber: Number(resumo.aReceber),
        estoqueValor: Number(resumo.estoqueValor),
        contasPagar: Number(resumo.contasPagar),
      },
      avisos: avisos.map((a) => ({
        tipo: a.tipo,
        label: a.label,
        count: a.count,
        total: Number(a.total),
        href: a.href,
      })),
      // Sem estoque não há o que consultar naquela linha; ordena pelo que tem
      // mais valor parado, que é o que interessa olhar primeiro.
      estoque: estoque
        .filter((p) => Number(p.quantity) !== 0)
        .sort((a, b) => Number(b.value) - Number(a.value))
        .slice(0, LIMITE_ESTOQUE)
        .map((p) => ({
          productId: p.productId,
          name: p.name,
          saleUnit: p.saleUnit,
          quantity: Number(p.quantity),
          value: Number(p.value),
        })),
      fiado: fiado.contas
        .slice(0, LIMITE_FIADO)
        .map((c) => ({
          id: c.id,
          cliente: c.customerName,
          saldo: Number(c.saldo),
          dueDate: c.dueDate ? c.dueDate.toISOString() : null,
          caixasComCliente: c.caixasComCliente,
        })),
      totais: {
        fiadoEmAberto: Number(fiado.totalGeral),
        caixasComClientes: fiado.totalCaixas,
      },
    };
  },
});
