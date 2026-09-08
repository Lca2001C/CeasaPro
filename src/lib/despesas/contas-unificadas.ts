import { money, sub, toDecimal, type Numeric } from "@/lib/money";
import { endOfDayTz, parseFormDateTz, startOfDayTz } from "@/lib/tz";
import type { DespesaFiltro } from "@/lib/validations/despesa";

/**
 * Uma linha da lista de contas — despesa lançada ou saldo de higienização.
 *
 * A tela não pergunta de qual módulo veio o gasto; o DTO carrega a origem só
 * para saber quais ações são válidas (pagar higienização não é excluir despesa).
 */
export type OrigemConta = "despesa" | "higienizacao";

export interface ContaUnificada {
  id: string;
  origem: OrigemConta;
  description: string;
  amount: string;
  type: "FIXA" | "VARIAVEL";
  status: "PENDENTE" | "PAGO";
  paymentMethod: string | null;
  recurring: boolean;
  categoryName: string | null;
  dueDate: string | null;
  paidDate: string | null;
  vencida: boolean;
}

export interface HigienizacaoParaLista {
  id: string;
  cleanerName: string;
  totalAmount: Numeric;
  paidAmount: Numeric;
  sentDate: Date;
  paidDate: Date | null;
  createdAt: Date;
}

export interface DespesaParaLista {
  id: string;
  description: string;
  amount: Numeric;
  type: "FIXA" | "VARIAVEL";
  status: "PENDENTE" | "PAGO";
  paymentMethod: string | null;
  recurring: boolean;
  categoryName: string | null;
  dueDate: Date | null;
  paidDate: Date | null;
}

/**
 * Como fatiar `[prefixo][resto]` com skip/take sem carregar o resto inteiro.
 *
 * Higienização (poucas linhas) vai na frente; despesas (milhares) continuam
 * paginadas no banco. Sem isto, ou a higienização só aparecia na página 1 de
 * um jeito torto, ou voltávamos a carregar 8.000 despesas em memória.
 */
export function fatiaListaComPrefixo(prefixCount: number, skip: number, take: number) {
  if (skip < prefixCount) {
    const prefixTake = Math.min(take, prefixCount - skip);
    return {
      prefixSkip: skip,
      prefixTake,
      restoSkip: 0,
      restoTake: Math.max(0, take - prefixTake),
    };
  }
  return {
    prefixSkip: 0,
    prefixTake: 0,
    restoSkip: skip - prefixCount,
    restoTake: take,
  };
}

export function linhaDeDespesa(d: DespesaParaLista, agora: Date): ContaUnificada {
  const hoje = startOfDayTz(agora);
  const pago = d.status === "PAGO";
  return {
    id: d.id,
    origem: "despesa",
    description: d.description,
    amount: toDecimal(d.amount).toFixed(2),
    type: d.type,
    status: d.status,
    paymentMethod: d.paymentMethod,
    recurring: d.recurring,
    categoryName: d.categoryName,
    dueDate: d.dueDate?.toISOString() ?? null,
    paidDate: d.paidDate?.toISOString() ?? null,
    vencida: !pago && d.dueDate !== null && d.dueDate < hoje,
  };
}

export function linhasDeHigienizacao(
  lote: HigienizacaoParaLista,
  filtro: DespesaFiltro,
  agora: Date,
): ContaUnificada[] {
  const saldo = money(sub(lote.totalAmount, lote.paidAmount));
  const temSaldo = saldo.greaterThan(0);
  const jaPagou = toDecimal(lote.paidAmount).greaterThan(0);
  const hoje = startOfDayTz(agora);
  const vencida = temSaldo && lote.sentDate < hoje;

  const pendente: ContaUnificada = {
    id: lote.id,
    origem: "higienizacao",
    description: `Higienização — ${lote.cleanerName}`,
    amount: saldo.toFixed(2),
    type: "VARIAVEL",
    status: "PENDENTE",
    paymentMethod: null,
    recurring: false,
    categoryName: "Higienização",
    dueDate: lote.sentDate.toISOString(),
    paidDate: null,
    vencida,
  };

  const paga: ContaUnificada = {
    id: lote.id,
    origem: "higienizacao",
    description: `Higienização — ${lote.cleanerName}`,
    amount: toDecimal(lote.paidAmount).toFixed(2),
    type: "VARIAVEL",
    status: "PAGO",
    paymentMethod: null,
    recurring: false,
    categoryName: "Higienização",
    dueDate: lote.sentDate.toISOString(),
    paidDate: lote.paidDate?.toISOString() ?? null,
    vencida: false,
  };

  const candidatas: ContaUnificada[] = [];
  if (filtro.vencidas) {
    if (vencida) candidatas.push(pendente);
  } else if (filtro.status === "PAGO") {
    if (jaPagou) candidatas.push(paga);
  } else if (filtro.status === "PENDENTE") {
    if (temSaldo) candidatas.push(pendente);
  } else {
    // Todas: uma linha — ainda deve, ou já quitou.
    if (temSaldo) candidatas.push(pendente);
    else if (jaPagou) candidatas.push(paga);
  }

  return candidatas.filter(() => higienizacaoPassaNoFiltro(lote, filtro));
}

function higienizacaoPassaNoFiltro(lote: HigienizacaoParaLista, filtro: DespesaFiltro): boolean {
  if (filtro.type === "FIXA") return false;
  if (filtro.categoryId) return false;

  if (filtro.q) {
    const q = filtro.q.toLowerCase();
    const texto = `higienização ${lote.cleanerName}`.toLowerCase();
    if (!texto.includes(q)) return false;
  }

  const from = filtro.from ? parseFormDateTz(filtro.from) : null;
  const to = filtro.to ? endOfDayTz(parseFormDateTz(filtro.to)) : null;
  if (!from && !to) return true;

  const campo = filtro.dateField ?? "dueDate";
  const quando =
    campo === "paidDate" ? lote.paidDate : campo === "createdAt" ? lote.createdAt : lote.sentDate;
  if (!quando) return false;
  if (from && quando < from) return false;
  if (to && quando > to) return false;
  return true;
}
