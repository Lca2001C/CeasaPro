import { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { CaixasService } from "./caixas.service";
import { add, gt, sub, money, toDecimal } from "@/lib/money";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import type {
  HigienizacaoInput,
  HigienizacaoUpdateInput,
  HigienizacaoDevolucaoInput,
  HigienizacaoPagamentoInput,
} from "@/lib/validations/higienizacao";
import type { TenantCtx } from "@/lib/http/with-action";
import type { CrateCleaningStatus } from "@prisma/client";
import { parseFormDateTz } from "@/lib/tz";

/**
 * Situação do lote a partir das DUAS pontas do ciclo: caixas e dinheiro.
 *
 *  - `ENVIADO`  — ainda tem caixa fora (nem devolvida, nem dada como perdida);
 *  - `DEVOLVIDO`— todas as caixas resolvidas, mas ainda se deve ao higienizador;
 *  - `PAGO`     — ciclo encerrado: caixas resolvidas E nada a pagar.
 *
 * A ordem importava e estava invertida: `PAGO` era decidido só pelo dinheiro,
 * então um lote sem cobrança (`unitPrice` zero, favor, acerto por fora) nascia
 * "pago" e saía das pendências com 50 caixas ainda no higienizador. Agora
 * `PAGO` exige o ciclo inteiro fechado, que é o que a palavra promete.
 */
function computeCleaningStatus(c: {
  sentQty: number;
  returnedQty: number;
  /** Caixas que o higienizador perdeu/quebrou — resolvem o lote sem voltar. */
  lostQty?: number;
  totalAmount: Prisma.Decimal | number;
  paidAmount: Prisma.Decimal | number;
}): CrateCleaningStatus {
  const resolvidas = c.returnedQty + (c.lostQty ?? 0);
  const caixasFechadas = resolvidas >= c.sentQty;
  const quitado = !gt(c.totalAmount, c.paidAmount); // pago >= total

  if (caixasFechadas && quitado) return "PAGO";
  if (caixasFechadas) return "DEVOLVIDO";
  return "ENVIADO";
}

/** Cliente mínimo aceito por `perdasPorLote` (prisma do tenant ou `tx`). */
type PerdasClient = {
  plasticCrateMovement: {
    findMany(args: {
      where: { crateCleaningId: { in: string[] }; type: "QUEBRA" };
      select: { crateCleaningId: true; quantity: true };
    }): Promise<{ crateCleaningId: string | null; quantity: number }[]>;
  };
};

/**
 * Caixas perdidas por lote, lidas do LIVRO-RAZÃO.
 *
 * Não existe coluna `lostQty`: a perda é um movimento `QUEBRA` ligado ao lote,
 * como todo o resto do controle de caixas. Derivar mantém uma única fonte da
 * verdade — o mesmo princípio do estoque de produtos.
 */
export async function perdasPorLote(
  db: PerdasClient,
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.plasticCrateMovement.findMany({
    where: { crateCleaningId: { in: ids }, type: "QUEBRA" },
    select: { crateCleaningId: true, quantity: true },
  });
  const mapa = new Map<string, number>();
  for (const r of rows) {
    if (!r.crateCleaningId) continue;
    mapa.set(r.crateCleaningId, (mapa.get(r.crateCleaningId) ?? 0) + r.quantity);
  }
  return mapa;
}

export const HigienizacaoService = {
  /**
   * Higienizadores já usados, para autocompletar o nome.
   * O histórico e o "quanto já paguei" são agrupados pelo texto digitado —
   * sem isto, "Silva" e "silva" viram dois prestadores diferentes.
   */
  async higienizadoresConhecidos(tenantId: string): Promise<string[]> {
    const db = getTenantPrisma(tenantId);
    const rows = await db.crateCleaning.findMany({
      distinct: ["cleanerName"],
      select: { cleanerName: true },
      orderBy: { cleanerName: "asc" },
      take: 200,
    });
    return rows.map((r) => r.cleanerName).filter(Boolean);
  },

  /**
   * Lista os lotes (com filtro opcional de status) + os totais do módulo.
   *
   * Os totais e as pendências são calculados sobre **TODOS** os lotes, nunca
   * sobre o filtro da tela. "Caixas a receber" e "Total a pagar" são o retrato
   * da operação: com o filtro em "Devolvidos" eles apareciam zerados, como se
   * não houvesse nada pendente, enquanto havia lotes abertos em "Enviados".
   * Filtrar muda a LISTA, não a realidade.
   */
  async list(tenantId: string, status?: CrateCleaningStatus) {
    const db = getTenantPrisma(tenantId);
    // Duas consultas, porque são duas perguntas.
    //
    // Os TOTAIS vêm de todos os lotes ainda não PAGO, sem `take`. Antes saíam
    // dos 500 envios mais recentes, e um lote antigo pendente além do 500º
    // sumia de "Caixas a receber" e "Total a pagar". Filtrar por `status` não
    // perde nada: PAGO é terminal (caixas resolvidas E nada a pagar — ver
    // `computeCleaningStatus`; editar, devolver, perder e pagar recusam lote
    // PAGO), então lote PAGO contribui zero para os quatro números.
    //
    // A LISTA exibida continua limitada.
    const [pendentesLotes, lista, saldo] = await Promise.all([
      db.crateCleaning.findMany({
        where: { status: { not: "PAGO" } },
        select: {
          id: true,
          sentQty: true,
          returnedQty: true,
          totalAmount: true,
          paidAmount: true,
        },
      }),
      db.crateCleaning.findMany({
        where: status ? { status } : {},
        orderBy: { sentDate: "desc" },
        take: 100,
      }),
      CaixasService.getSaldo(tenantId),
    ]);

    const ids = [...new Set([...pendentesLotes.map((c) => c.id), ...lista.map((c) => c.id)])];
    const perdas = await perdasPorLote(db, ids);
    const derivar = <
      T extends {
        id: string;
        sentQty: number;
        returnedQty: number;
        totalAmount: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
      },
    >(
      c: T,
    ) => {
      const perdidas = perdas.get(c.id) ?? 0;
      return {
        ...c,
        perdidas,
        caixasAReceber: Math.max(0, c.sentQty - c.returnedQty - perdidas),
        valorAPagar: money(sub(c.totalAmount, c.paidAmount)),
      };
    };
    const emAberto = pendentesLotes.map(derivar);

    // Totais derivados (§8.8) — sempre globais.
    const caixasAReceber = emAberto.reduce((a, c) => a + c.caixasAReceber, 0);
    const totalAPagar = money(add(...emAberto.map((c) => c.valorAPagar)));

    // Pendências do ciclo — cada uma tem uma ação diferente, então são
    // contadas separadamente em vez de um único "em aberto".
    const aguardandoDevolucao = emAberto.filter((c) => c.caixasAReceber > 0).length;
    const aguardandoPagamento = emAberto.filter((c) => gt(c.valorAPagar, 0)).length;

    const registros = lista.map(derivar);

    return {
      registros,
      caixasAReceber,
      totalAPagar,
      aguardandoDevolucao,
      aguardandoPagamento,
      saldo,
    };
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const c = await db.crateCleaning.findFirst({ where: { id } });
    if (!c) throw new NotFoundError("Registro de higienização não encontrado");
    const movimentos = await CaixasService.listByLink(tenantId, { crateCleaningId: c.id });
    const perdidas = movimentos
      .filter((m) => m.type === "QUEBRA")
      .reduce((a, m) => a + m.quantity, 0);
    return {
      ...c,
      perdidas,
      caixasAReceber: Math.max(0, c.sentQty - c.returnedQty - perdidas),
      valorAPagar: money(sub(c.totalAmount, c.paidAmount)),
      movimentos,
    };
  },

  /** Envia caixas sujas ao higienizador — baixa do estoque de sujas (atômico). */
  async create(input: HigienizacaoInput, ctx: TenantCtx) {
    const totalAmount = FinancialCalc.valorTotalVenda(input.sentQty, input.unitPrice);
    const db = getTenantPrisma(ctx.tenantId);

    return db.$transaction(async (tx) => {
      const c = await tx.crateCleaning.create({
        data: {
          tenantId: ctx.tenantId,
          cleanerName: input.cleanerName,
          sentDate: parseFormDateTz(input.sentDate),
          sentQty: input.sentQty,
          unitPrice: input.unitPrice,
          totalAmount,
          notes: input.notes ?? null,
        },
      });

      await CaixasService.registrarInTx(
        tx,
        {
          type: "SAIDA_HIGIENIZACAO",
          quantity: input.sentQty,
          cleanerName: input.cleanerName,
          movementDate: input.sentDate,
          crateCleaningId: c.id,
          notes: "Envio para higienização",
        },
        ctx,

      );

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "CrateCleaning",
          entityId: c.id,
          newData: {
            cleanerName: c.cleanerName,
            sentQty: c.sentQty,
            totalAmount: totalAmount.toString(),
          },
          ip: ctx.ip,
        },
        tx,
      );
      return c;
    });
  },

  /** Ajusta o lote antes de qualquer devolução/pagamento. */
  async update(input: HigienizacaoUpdateInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);

    return db.$transaction(async (tx) => {
      // Trava ANTES de ler o lote: uma devolução que comitasse entre a leitura
      // de `before` (returnedQty 0) e a gravação final deixava sentQty=10 com
      // returnedQty=50, e "Em higienização" negativo.
      await CaixasService.travarInTx(tx, ctx.tenantId);
      const before = await tx.crateCleaning.findFirst({ where: { id: input.id } });
      if (!before) throw new NotFoundError("Registro não encontrado");
      if (before.returnedQty > 0 || !toDecimal(before.paidAmount).isZero()) {
        throw new BusinessRuleError(
          "Este envio já teve devolução ou pagamento — não pode mais ser alterado.",
        );
      }
      // Perda registrada também tranca a edição, como já acontece no `remove`.
      //
      // `registrarPerda` grava a QUEBRA e atualiza só o `status` — nunca
      // `returnedQty` nem `paidAmount` —, então o lápis "Editar envio"
      // continuava visível depois de o higienizador quebrar caixas. Reduzir a
      // quantidade enviada nesse estado encurtava a SAIDA_HIGIENIZACAO abaixo do
      // que já saiu: o painel passava a mostrar "Em higienização: -10"
      // (`computeCrateSaldo` não tem piso) e o estoque de sujas ganhava caixas
      // fantasma — que o próprio painel manda higienizar no atalho "<n> caixa(s)
      // suja(s)". O dono levava ao higienizador caixas que foram quebradas e não
      // existem mais, e a contagem física nunca voltava a fechar.
      //
      // Não precisa de concorrência: um usuário só, dois cliques.
      const perdidas = (await perdasPorLote(tx, [before.id])).get(before.id) ?? 0;
      if (perdidas > 0) {
        throw new BusinessRuleError(
          `Este envio já tem ${perdidas} caixa(s) registrada(s) como perdida(s) — ` +
            "não pode mais ser alterado.",
        );
      }

      const totalAmount = FinancialCalc.valorTotalVenda(input.sentQty, input.unitPrice);
      const delta = input.sentQty - before.sentQty;

      // Ajusta o livro-razão: mais caixas → nova saída; menos caixas → retorno parcial.
      if (delta > 0) {
        await CaixasService.registrarInTx(
          tx,
          {
            type: "SAIDA_HIGIENIZACAO",
            quantity: delta,
            cleanerName: input.cleanerName,
            movementDate: input.sentDate,
            crateCleaningId: before.id,
            notes: "Ajuste do envio para higienização",
          },
          ctx,

        );
      } else if (delta < 0) {
        // Diminuir a quantidade enviada DESFAZ parte da saída — não é retorno.
        //
        // Compensar com `RETORNO_HIGIENIZACAO` era o que estava aqui, e
        // `resolveDirty` mapeia esse tipo para `dirty: false`: enviar 50 sujas,
        // perceber que eram 40 e corrigir fazia 10 caixas migrarem de
        // "em higienização" para LIMPAS sem terem sido lavadas.
        //
        // O próprio `remove` documenta que compensar seria errado por esse
        // exato motivo e por isso APAGA os movimentos. Aqui a correção é a
        // mesma, restrita ao excedente: as caixas voltam para o pote de onde
        // saíram (sujas), porque de fato nunca saíram.
        //
        // Só é alcançável quando não houve devolução, pagamento nem perda — a
        // guarda no topo do método garante isso.
        //
        // Mas a guarda olha só o LOTE, e o pote "em higienização" é da empresa.
        // Se as caixas já saíram dele por outro caminho (um movimento de
        // higienizador lançado solto, de antes de `registrarInTx` exigir o
        // vínculo), apagar a saída levava o pote a negativo e criava sujas
        // fantasma, que o painel manda higienizar.
        const saldo = await CaixasService.getSaldoInTx(tx, ctx.tenantId);
        if (saldo.emHigienizacao < -delta) {
          throw new BusinessRuleError(
            `Há ${saldo.emHigienizacao} caixa(s) no higienizador — não dá para tirar ` +
              `${-delta} deste envio. Confira as caixas que já voltaram.`,
          );
        }
        let restante = -delta;
        const saidas = await tx.plasticCrateMovement.findMany({
          where: {
            tenantId: ctx.tenantId,
            crateCleaningId: before.id,
            type: "SAIDA_HIGIENIZACAO",
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, quantity: true },
        });
        for (const mov of saidas) {
          if (restante <= 0) break;
          if (mov.quantity <= restante) {
            await tx.plasticCrateMovement.delete({ where: { id: mov.id } });
            restante -= mov.quantity;
          } else {
            await tx.plasticCrateMovement.update({
              where: { id: mov.id },
              data: { quantity: mov.quantity - restante },
            });
            restante = 0;
          }
        }
        if (restante > 0) {
          throw new BusinessRuleError(
            "Não foi possível reduzir o envio: o livro-razão não tem saída suficiente " +
              "para este lote. Exclua o envio e lance de novo.",
          );
        }
      }

      // Compare-and-set no estado que liberou a edição (nada devolvido, nada
      // pago). O lock acima já serializa; isto é a segunda linha de defesa.
      const escrito = await tx.crateCleaning.updateMany({
        where: { id: before.id, returnedQty: 0, paidAmount: before.paidAmount },
        data: {
          cleanerName: input.cleanerName,
          sentDate: parseFormDateTz(input.sentDate),
          sentQty: input.sentQty,
          unitPrice: input.unitPrice,
          totalAmount,
          notes: input.notes ?? null,
        },
      });
      if (escrito.count !== 1) {
        throw new BusinessRuleError(
          "Este envio teve devolução ou pagamento agora mesmo — não pode mais ser alterado.",
        );
      }
      const updated = await tx.crateCleaning.findFirstOrThrow({ where: { id: before.id } });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "CrateCleaning",
          entityId: before.id,
          oldData: { sentQty: before.sentQty, unitPrice: before.unitPrice.toString() },
          newData: { sentQty: updated.sentQty, unitPrice: updated.unitPrice.toString() },
          ip: ctx.ip,
        },
        tx,
      );
      return updated;
    });
  },

  /** Higienizador devolveu caixas limpas — voltam ao estoque de limpas. */
  async registrarDevolucao(input: HigienizacaoDevolucaoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);

    return db.$transaction(async (tx) => {
      // Trava antes de ler devolvidas E perdidas. O compare-and-set abaixo só
      // enxerga `returnedQty`; uma perda simultânea (que não mexe nele) passava
      // pelas duas guardas e o lote resolvia 6 caixas de 3 pendentes.
      await CaixasService.travarInTx(tx, ctx.tenantId);
      const c = await tx.crateCleaning.findFirst({ where: { id: input.id } });
      if (!c) throw new NotFoundError("Registro não encontrado");

      // Caixa dada como perdida não pode voltar a caber na devolução, senão o
      // lote aceitaria mais caixas do que saíram.
      const perdidas = (await perdasPorLote(tx, [c.id])).get(c.id) ?? 0;
      const novoDevolvido = c.returnedQty + input.quantity;
      const pendentes = c.sentQty - c.returnedQty - perdidas;
      if (input.quantity > pendentes) {
        throw new BusinessRuleError(
          pendentes <= 0
            ? "Este envio já está todo resolvido."
            : `Faltam apenas ${pendentes} caixa(s) para devolver.`,
        );
      }
      const status = computeCleaningStatus({
        ...c,
        returnedQty: novoDevolvido,
        lostQty: perdidas,
      });
      // Compare-and-set no `returnedQty` lido acima. Era ler-decidir-escrever:
      // em READ COMMITTED (padrão do Postgres) duas devoluções parciais
      // simultâneas leem o mesmo `returnedQty` e a segunda grava o total dela
      // por cima da primeira. O lote ficava com menos caixas devolvidas do que
      // os movimentos de ledger registram — travado num pendente que ninguém
      // mais consegue quitar, porque a guarda de `pendentes` passa a recusar o
      // resto. O Postgres reavalia o WHERE depois de esperar o lock da linha,
      // então o segundo não casa e é recusado com mensagem.
      const escrito = await tx.crateCleaning.updateMany({
        where: { id: c.id, returnedQty: c.returnedQty },
        data: { returnedQty: novoDevolvido, returnedDate: parseFormDateTz(input.returnedDate), status },
      });
      if (escrito.count !== 1) {
        throw new BusinessRuleError(
          "Outra devolução deste envio foi registrada agora mesmo. " +
            "Confira quantas caixas faltam e lance de novo.",
        );
      }
      const updated = await tx.crateCleaning.findFirstOrThrow({ where: { id: c.id } });

      await CaixasService.registrarInTx(
        tx,
        {
          type: "RETORNO_HIGIENIZACAO",
          quantity: input.quantity,
          cleanerName: c.cleanerName,
          movementDate: input.returnedDate,
          crateCleaningId: c.id,
          notes: "Devolução da higienização",
        },
        ctx,

      );

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "CrateCleaning",
          entityId: c.id,
          oldData: { returnedQty: c.returnedQty },
          newData: { returnedQty: novoDevolvido, status },
          ip: ctx.ip,
        },
        tx,
      );
      return updated;
    });
  },

  /**
   * Caixas que o higienizador perdeu ou quebrou.
   *
   * Sem isto o lote nunca fechava: enviou 50, voltaram 47, e as 3 restantes
   * ficavam para sempre como "aguardando devolução" — o painel cobrava uma
   * devolução que não vai acontecer, e o saldo `emHigienizacao` também não
   * zerava. A perda é gravada como `QUEBRA` ligada ao lote (o mesmo livro-razão
   * de sempre), e o lote passa a considerar essas caixas resolvidas.
   *
   * Não mexe no valor a pagar: se o higienizador quebrou caixa, se ele desconta
   * do serviço é negociação entre as partes — o sistema não decide isso sozinho.
   */
  async registrarPerda(
    input: { id: string; quantity: number; movementDate: string; notes?: string | null },
    ctx: TenantCtx,
  ) {
    const db = getTenantPrisma(ctx.tenantId);

    return db.$transaction(async (tx) => {
      // Trava ANTES de ler as pendências. O lock era tomado só dentro de
      // `registrarInTx`, depois desta leitura: duas perdas de 3 (toque duplo,
      // duas abas) no mesmo lote liam as duas "pendentes = 3" e passavam. A
      // guarda global do ledger não pegava, porque outro lote do mesmo
      // higienizador cobria a diferença — e esse outro lote depois não
      // conseguia devolver as próprias caixas.
      await CaixasService.travarInTx(tx, ctx.tenantId);
      const c = await tx.crateCleaning.findFirst({ where: { id: input.id } });
      if (!c) throw new NotFoundError("Registro não encontrado");

      const jaPerdidas = await perdasPorLote(tx, [c.id]);
      const perdidas = jaPerdidas.get(c.id) ?? 0;
      const pendentes = c.sentQty - c.returnedQty - perdidas;
      if (input.quantity > pendentes) {
        throw new BusinessRuleError(
          pendentes <= 0
            ? "Este envio já está todo resolvido."
            : `Só faltam ${pendentes} caixa(s) neste envio.`,
        );
      }

      await CaixasService.registrarInTx(
        tx,
        {
          type: "QUEBRA",
          quantity: input.quantity,
          cleanerName: c.cleanerName,
          movementDate: input.movementDate,
          crateCleaningId: c.id,
          notes: input.notes ?? "Caixa perdida no higienizador",
        },
        ctx,

      );

      const status = computeCleaningStatus({
        ...c,
        lostQty: perdidas + input.quantity,
      });
      // Compare-and-set nas colunas que entram no status. O lock já serializa;
      // isto recusa em vez de gravar um status calculado sobre dado velho.
      const escrito = await tx.crateCleaning.updateMany({
        where: { id: c.id, returnedQty: c.returnedQty, paidAmount: c.paidAmount },
        data: { status },
      });
      if (escrito.count !== 1) {
        throw new BusinessRuleError(
          "Este envio mudou agora mesmo. Confira quantas caixas faltam e lance de novo.",
        );
      }
      const updated = await tx.crateCleaning.findFirstOrThrow({ where: { id: c.id } });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "CrateCleaning",
          entityId: c.id,
          oldData: { status: c.status, perdidas },
          newData: { status, perdidas: perdidas + input.quantity },
          ip: ctx.ip,
        },
        tx,
      );
      return updated;
    });
  },

  async registrarPagamento(input: HigienizacaoPagamentoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      // O status depende das perdas, que o CAS em `paidAmount` não enxerga:
      // pagamento final + perda final simultâneos gravavam os dois um status
      // calculado sobre a metade velha (ENVIADO/DEVOLVIDO em vez de PAGO).
      await CaixasService.travarInTx(tx, ctx.tenantId);
      const c = await tx.crateCleaning.findFirst({ where: { id: input.id } });
      if (!c) throw new NotFoundError("Registro não encontrado");
      const saldo = sub(c.totalAmount, c.paidAmount);
      if (gt(input.amount, saldo)) {
        throw new BusinessRuleError(`O valor é maior que o saldo a pagar (${saldo.toString()}).`);
      }
      const novoPago = money(add(c.paidAmount, input.amount));
      // O status precisa das duas pontas: pagar tudo não encerra o lote se
      // ainda há caixa fora.
      const perdidas = (await perdasPorLote(tx, [c.id])).get(c.id) ?? 0;
      const status = computeCleaningStatus({
        ...c,
        paidAmount: novoPago,
        lostQty: perdidas,
      });
      // Compare-and-set no `paidAmount` lido acima — mesma razão da devolução
      // e do pagamento de fiado: dois lançamentos simultâneos liam o mesmo
      // saldo e o segundo gravava o total dele por cima do primeiro, deixando
      // dinheiro pago fora da conta do higienizador.
      const escrito = await tx.crateCleaning.updateMany({
        where: { id: c.id, paidAmount: c.paidAmount },
        data: { paidAmount: novoPago, paidDate: parseFormDateTz(input.paidDate), status },
      });
      if (escrito.count !== 1) {
        throw new BusinessRuleError(
          "Outro pagamento deste envio foi registrado agora mesmo. " +
            "Confira o saldo e lance de novo.",
        );
      }
      // Uma linha por pagamento, na MESMA transação.
      //
      // `paidAmount` é acumulado e `paidDate` é sobrescrito, então os dois
      // juntos não dizem quanto saiu do caixa em que dia. O fluxo de caixa
      // somava `paidAmount` por `paidDate` e jogava o valor cheio do lote no
      // dia do ÚLTIMO pagamento — deixando o dia do primeiro sem despesa e
      // sumindo com o lote quando o último caía fora do período.
      await tx.crateCleaningPayment.create({
        data: {
          tenantId: ctx.tenantId,
          cleaningId: c.id,
          amount: input.amount,
          paidAt: parseFormDateTz(input.paidDate),
        },
      });

      const updated = await tx.crateCleaning.findFirstOrThrow({ where: { id: c.id } });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "PAYMENT",
          entity: "CrateCleaning",
          entityId: c.id,
          oldData: { paidAmount: c.paidAmount.toString() },
          newData: { paidAmount: novoPago.toString(), status },
          ip: ctx.ip,
        },
        tx,
      );
      return updated;
    });
  },

  /**
   * Exclui um envio lançado por engano.
   *
   * **Só quando nada aconteceu ainda** — sem devolução, sem perda e sem
   * pagamento. Devolução e perda são fatos físicos: apagar o registro não
   * traz a caixa de volta ao higienizador nem desquebra nada, só some com a
   * história. Nesse caso o caminho é acertar pelo próprio lote, não excluir.
   *
   * Os movimentos são APAGADOS, não compensados. Compensar com
   * `RETORNO_HIGIENIZACAO` colocaria as caixas em `limpas` — mas elas saíram
   * SUJAS e nunca foram lavadas. O envio estaria "lavando" caixa no papel.
   * Apagar o movimento devolve o saldo exatamente ao estado anterior: sujas.
   */
  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);

    await db.$transaction(async (tx) => {
      await CaixasService.travarInTx(tx, ctx.tenantId);
      const before = await tx.crateCleaning.findFirst({ where: { id } });
      if (!before) throw new NotFoundError("Registro não encontrado");
      if (!toDecimal(before.paidAmount).isZero()) {
        throw new BusinessRuleError("Não é possível excluir um registro com pagamentos.");
      }
      if (before.returnedQty > 0) {
        throw new BusinessRuleError(
          "Este envio já teve devolução registrada e não pode ser excluído — " +
            "apagá-lo faria as caixas devolvidas sumirem do controle.",
        );
      }
      const perdidas = (await perdasPorLote(tx, [before.id])).get(before.id) ?? 0;
      if (perdidas > 0) {
        throw new BusinessRuleError(
          "Este envio já teve perda registrada e não pode ser excluído.",
        );
      }

      // Apagar a saída devolve as caixas às sujas — só se elas ainda estão no
      // pote "em higienização". Se já saíram dele por outro caminho, apagar
      // deixava o pote negativo e somava sujas que não existem.
      const saidas = await tx.plasticCrateMovement.findMany({
        where: {
          tenantId: ctx.tenantId,
          crateCleaningId: before.id,
          type: "SAIDA_HIGIENIZACAO",
        },
        select: { quantity: true },
      });
      const noHigienizador = saidas.reduce((a, m) => a + m.quantity, 0);
      const saldo = await CaixasService.getSaldoInTx(tx, ctx.tenantId);
      if (saldo.emHigienizacao < noHigienizador) {
        throw new BusinessRuleError(
          `Há ${saldo.emHigienizacao} caixa(s) no higienizador, e este envio tirou ` +
            `${noHigienizador}. Registre a devolução ou a perda no envio em vez de excluí-lo.`,
        );
      }

      await tx.plasticCrateMovement.deleteMany({
        where: { tenantId: ctx.tenantId, crateCleaningId: before.id },
      });

      await tx.crateCleaning.update({ where: { id }, data: { deletedAt: new Date() } });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "DELETE",
          entity: "CrateCleaning",
          entityId: id,
          oldData: before,
          ip: ctx.ip,
        },
        tx,
      );
    });
  },
};
