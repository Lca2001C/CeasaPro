import { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { FinancialCalc } from "./financial-calc.service";
import { money } from "@/lib/money";
import { addDaysTz, endOfDayTz, startOfDayTz } from "@/lib/tz";
import { isModuleEnabled } from "@/lib/plan/modules";
import { frase } from "@/lib/cotacoes/alerta";
import { formatBRL } from "@/lib/format";

export type TipoDeAviso =
  | "fiado_vencido"
  | "despesa_vencida"
  | "despesa_a_vencer"
  | "higienizacao_pendente"
  | "cotacao_variacao";

export interface Aviso {
  tipo: TipoDeAviso;
  count: number;
  /**
   * Quanto dinheiro o aviso põe em jogo — ou `null` quando não há dinheiro.
   *
   * O `null` não é conveniência de tipo: os três lugares que renderizam um
   * aviso passam este campo por um formatador de REAIS (o cartão do Início, o
   * snapshot do PWA e a tela de consulta offline). O aviso de cotação fala de
   * variação percentual, e enfiar 3,2 aqui faria as três telas escreverem
   * "R$ 3,20" com toda a naturalidade — um número plausível, do jeito errado,
   * que é o defeito mais difícil de perceber que existe.
   *
   * O percentual vai no `label`, que é justamente o que a notificação usa.
   */
  total: Prisma.Decimal | null;
  href: string;
  label: string;
}

/**
 * Avisos operacionais para o topo do dashboard (o que precisa de atenção) e
 * para a notificação diária por push.
 *
 * Duas regras de produto governam o `href` de cada aviso:
 *
 *  - **Leva ao recorte, não à lista inteira.** Mandar para `/despesas` obrigava
 *    o dono do box a procurar, numa lista de meses, o que tinha vencido. Agora o
 *    link já chega filtrado.
 *  - **Uma conta só → leva à conta.** Quando o aviso é de um único item, o
 *    destino é a própria despesa: da notificação ao botão de pagar, sem escala.
 */
export const AvisosService = {
  /**
   * @param modules módulos do plano. Higienização só entra se estiver
   *   contratada: sem isso, a empresa que saiu do plano continuava vendo
   *   "Higienização a pagar" no topo do painel, e o toque levava a
   *   `/plano?bloqueado=higienizacao`. Pelo push era pior — a notificação do
   *   dia podia ser exatamente essa e caía no paywall, o oposto do que o
   *   serviço de push se propõe. `ContasPagarService.get` já fazia isto.
   */
  async get(
    tenantId: string,
    modules?: string[],
    agora = new Date(),
  ): Promise<Aviso[]> {
    const db = getTenantPrisma(tenantId);
    // O corte é o INÍCIO de hoje, não "agora": uma conta que vence hoje não
    // está vencida às 9h da manhã. Era o que acontecia com `dueDate < now`, e
    // divergia da lista de despesas, que já usava o começo do dia.
    const hoje = startOfDayTz(agora);
    const em7dias = endOfDayTz(addDaysTz(agora, 7));

    const [fiadoVenc, despVenc, despAVencer, higPend] = await Promise.all([
      db.creditAccount.findMany({
        where: { status: "EM_ABERTO", dueDate: { lt: hoje } },
        select: { totalAmount: true, paidAmount: true },
      }),
      // findMany em vez de aggregate: o id é o que permite linkar direto na
      // despesa quando existe apenas uma vencida.
      db.expense.findMany({
        where: { status: "PENDENTE", dueDate: { lt: hoje } },
        select: { id: true, amount: true },
        orderBy: { dueDate: "asc" },
      }),
      db.expense.findMany({
        where: { status: "PENDENTE", dueDate: { gte: hoje, lte: em7dias } },
        select: { id: true, amount: true },
        orderBy: { dueDate: "asc" },
      }),
      isModuleEnabled(modules, "higienizacao")
        ? db.crateCleaning.findMany({
            where: { status: { not: "PAGO" } },
            select: { totalAmount: true, paidAmount: true },
          })
        : [],
    ]);

    const avisos: Aviso[] = [];
    const somar = (linhas: { amount: Prisma.Decimal }[]) =>
      money(linhas.reduce((a, l) => a.plus(l.amount), new Prisma.Decimal(0)));

    if (fiadoVenc.length > 0) {
      const total = FinancialCalc.saldoFiado(
        fiadoVenc.reduce((a, c) => a.plus(c.totalAmount), new Prisma.Decimal(0)),
        fiadoVenc.reduce((a, c) => a.plus(c.paidAmount), new Prisma.Decimal(0)),
      );
      avisos.push({
        tipo: "fiado_vencido",
        count: fiadoVenc.length,
        total,
        href: "/fiado",
        label: `${fiadoVenc.length} cliente(s) com fiado vencido`,
      });
    }

    if (despVenc.length > 0) {
      avisos.push({
        tipo: "despesa_vencida",
        count: despVenc.length,
        total: somar(despVenc),
        href:
          despVenc.length === 1
            ? `/despesas/${despVenc[0]!.id}`
            : "/despesas?vencidas=1",
        label: `${despVenc.length} despesa(s) vencida(s)`,
      });
    }

    if (despAVencer.length > 0) {
      avisos.push({
        tipo: "despesa_a_vencer",
        count: despAVencer.length,
        total: somar(despAVencer),
        href:
          despAVencer.length === 1
            ? `/despesas/${despAVencer[0]!.id}`
            : "/despesas?status=PENDENTE&proximos=7",
        label: `${despAVencer.length} despesa(s) vencem em 7 dias`,
      });
    }

    if (higPend.length > 0) {
      const total = higPend.reduce(
        (a, c) => a.plus(c.totalAmount).minus(c.paidAmount),
        new Prisma.Decimal(0),
      );
      if (total.greaterThan(0)) {
        avisos.push({
          tipo: "higienizacao_pendente",
          count: higPend.length,
          total,
          href: "/higienizacao",
          label: `Higienização a pagar`,
        });
      }
    }

    /*
      Cotação vai por ÚLTIMO, e a posição é regra, não estética.

      O push usa `avisos[0].href` como destino do toque (ver
      `push-avisos.service.ts`), então pôr cotação na frente trocaria o destino
      da notificação de todo mundo: quem tem uma despesa vencida deixaria de
      cair na despesa. Dinheiro a pagar hoje vem antes de preço de referência.

      É UM aviso agregado, e não um por produto: o cartão do Início e a tela
      offline usam `key={aviso.tipo}`, então um por produto produziria chaves
      repetidas — e, pior, encheria a notificação diária com uma linha por item.
    */
    if (isModuleEnabled(modules, "cotacoes")) {
      const { CotacoesAlertasService } = await import("./cotacoes-alertas.service");
      const r = await CotacoesAlertasService.disparosDoBoletim(tenantId, agora);
      if (r && r.disparos.length > 0) {
        const primeiro = r.disparos[0]!;
        const resto = r.disparos.length - 1;
        avisos.push({
          tipo: "cotacao_variacao",
          count: r.disparos.length,
          // Variação não é dinheiro. Ver o comentário de `Aviso.total`.
          total: null,
          // Um disparo só leva ao produto; vários levam à lista, porque não há
          // um produto para escolher.
          href:
            r.disparos.length === 1
              ? `/cotacoes/produto/${primeiro.ceasaProductId}?u=${encodeURIComponent(primeiro.unit)}`
              : "/cotacoes",
          label:
            frase(
              primeiro.meuProdutoNome ?? primeiro.nome,
              primeiro.motivos,
              primeiro.variacao,
              formatBRL(primeiro.refPrice),
            ) + (resto > 0 ? ` e mais ${resto}` : ""),
        });
      }
    }

    return avisos;
  },
};
