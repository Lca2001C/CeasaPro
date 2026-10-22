import type {
  SubscriptionStatus,
  TenantStatus,
  StatusSource,
} from "@prisma/client";
import { civilParts, zonedTimeToUtc } from "@/lib/tz";

export type AccessDecision = "ok" | "warn" | "blocked";

/** Dias de uso grátis concedidos ao confirmar o e-mail no cadastro público. */
export const TRIAL_DAYS = 7;

/** A partir de quantos dias restantes o banner de fim de teste aparece. */
export const TRIAL_WARN_DAYS = 2;

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** Fim do teste grátis contado a partir da confirmação do e-mail. */
export function trialEndFrom(start: Date): Date {
  return new Date(start.getTime() + TRIAL_DAYS * UM_DIA_MS);
}

/**
 * Dias inteiros que ainda faltam para o fim do teste, arredondando para cima:
 * faltando 1,2 dias o cliente lê "2 dias", não "1". Nunca negativo.
 */
export function trialDaysLeft(trialEndsAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / UM_DIA_MS));
}

/**
 * Avança exatamente um mês NO CALENDÁRIO BRASILEIRO, sem "vazar" para o mês
 * seguinte.
 *
 * `setMonth` nativo transformaria 31/08 em 01/10 (e 31/01 em 03/03), dando
 * dias de uso não pagos a cada renovação. Aqui o dia é limitado ao último dia
 * do mês de destino: 31/08 → 30/09, 31/01 → 28/02 (29/02 em ano bissexto).
 *
 * A conta é feita sobre a data CIVIL em `America/Sao_Paulo` (`tz.ts`), e a hora
 * do dia é preservada nesse fuso. Fazê-la em UTC errava a noite: 30/08 às 22h
 * no Brasil já é 31/08 em UTC, o limite caía em 30/09 01:00 UTC — 29/09 às 22h
 * aqui — e o cliente perdia um dia do mês pago. O resultado continua sem
 * depender do fuso do servidor: o fuso usado é o do app, sempre.
 */
export function addOneMonth(from: Date, diaAncora?: number | null): Date {
  return moverUmMes(from, 1, diaAncora);
}

/**
 * Recua um mês na mesma regra de {@link addOneMonth}. É o inverso do período
 * mensal: tirar um mês pago (estorno) devolve o vencimento ao do mês anterior,
 * na âncora — 31/03 recua para 28/02, não para 03/03 (31 dias antes).
 */
export function subOneMonth(from: Date, diaAncora?: number | null): Date {
  return moverUmMes(from, -1, diaAncora);
}

/** Dia do mês (1–31) do instante, no calendário de Brasília. */
export function diaCivil(d: Date): number {
  return civilParts(d).day;
}

/**
 * O vencimento cai na âncora? (o dia dela, ou o último dia do mês quando o mês
 * é mais curto). Todo vencimento gerado pelos fluxos cai; um que não cai foi
 * mexido à mão (suporte corrigindo o banco), e aí é o vencimento que manda —
 * seguir a âncora velha mudaria o dia que alguém escolheu de propósito.
 */
export function ancoraCoerente(vencimento: Date, diaAncora: number): boolean {
  const c = civilParts(vencimento);
  const ultimoDia = new Date(Date.UTC(c.year, c.month, 0)).getUTCDate();
  return c.day === Math.min(diaAncora, ultimoDia);
}

/** A âncora que vale para o vencimento: a gravada, se coerente; senão, o dia dele. */
export function ancoraDoVencimento(vencimento: Date, diaAncora: number | null): number {
  return diaAncora != null && ancoraCoerente(vencimento, diaAncora) ? diaAncora : diaCivil(vencimento);
}

/**
 * Um mês para frente ou para trás no calendário de Brasília, mantendo a hora.
 *
 * O dia de destino é o DIA ÂNCORA da assinatura, limitado ao último dia do mês
 * de destino — não o dia da data de partida. Partir do dia já ajustado fazia o
 * vencimento deslizar para sempre: 31/01 → 28/02 → 28/03 → 28/04. Com a âncora
 * 31: 31/01 → 28/02 → 31/03 → 30/04 → 31/05. Sem âncora, vale o dia da partida
 * (o comportamento de antes, para quem chama sem assinatura).
 */
function moverUmMes(from: Date, passo: 1 | -1, diaAncora?: number | null): Date {
  const c = civilParts(from);
  let ano = c.year;
  let mes = c.month + passo;
  if (mes === 13) {
    mes = 1;
    ano += 1;
  } else if (mes === 0) {
    mes = 12;
    ano -= 1;
  }
  // Dia 0 do mês seguinte ao de destino = último dia do destino (`mes` é 1-12,
  // e o `Date.UTC` o lê como índice 0-11, isto é, o mês DEPOIS dele).
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = diaAncora != null && diaAncora >= 1 && diaAncora <= 31 ? diaAncora : c.day;
  return zonedTimeToUtc(
    ano,
    mes,
    Math.min(dia, ultimoDia),
    c.hour,
    c.minute,
    c.second,
    from.getUTCMilliseconds(),
  );
}

/**
 * Decisao de acesso a partir do status da empresa e da assinatura.
 * Fonte unica usada pelo proxy, pelo wrapper de acoes e pelas telas.
 *  - blocked: bloqueio total (redireciona para /conta/suspensa)
 *  - warn:    acesso liberado com aviso de vencimento
 *  - ok:      acesso normal
 *
 * `TRIAL` é acesso normal: durante os 7 dias o uso é ilimitado. O aviso de fim de
 * teste NÃO passa por aqui — ver `billingNotice`, que precisa dos dias restantes
 * e de uma mensagem diferente da de mensalidade vencida.
 */
export function accessDecision(
  tenantStatus: TenantStatus | null | undefined,
  subStatus: SubscriptionStatus | null | undefined,
): AccessDecision {
  if (tenantStatus === "SUSPENDED" || tenantStatus === "BLOCKED") return "blocked";
  if (
    subStatus === "SUSPENSO" ||
    subStatus === "BLOQUEADO" ||
    subStatus === "CANCELADO"
  ) {
    return "blocked";
  }
  if (subStatus === "VENCIDO") return "warn";
  return "ok";
}

/** Aviso a exibir no topo do sistema. `null` = nada a avisar. */
export type BillingNotice =
  | { kind: "trial_ending"; daysLeft: number }
  | { kind: "overdue" }
  | { kind: "cancelled"; accessUntil: Date }
  | null;

/**
 * Aviso do topo do dashboard, separado de `accessDecision` de propósito.
 *
 * São duas situações diferentes que exigem mensagens diferentes: "seu teste
 * termina em 2 dias" (nunca pagou, precisa contratar) e "sua mensalidade venceu"
 * (é cliente, precisa regularizar). Espremer as duas no `"warn"` de
 * `accessDecision` daria a frase errada a metade dos casos — e `accessDecision`
 * não tem como expressar quantos dias faltam.
 */
export function billingNotice(args: {
  subStatus: SubscriptionStatus | null | undefined;
  trialEndsAt: Date | null | undefined;
  cancelledAt?: Date | null;
  currentPeriodEnd?: Date | null;
  now?: Date;
}): BillingNotice {
  const now = args.now ?? new Date();

  // Cancelou e o mês pago ainda vale: avisa que não haverá renovação, sem
  // empurrar para "Pagar agora" — o período já está quitado.
  if (
    args.cancelledAt &&
    args.subStatus === "ATIVO" &&
    args.currentPeriodEnd &&
    now <= args.currentPeriodEnd
  ) {
    return { kind: "cancelled", accessUntil: args.currentPeriodEnd };
  }

  if (args.subStatus === "TRIAL" && args.trialEndsAt) {
    const daysLeft = trialDaysLeft(args.trialEndsAt, now);
    // Só avisa na reta final: banner desde o 1º dia vira ruído e o cliente
    // aprende a ignorá-lo justamente antes de ele importar.
    if (daysLeft <= TRIAL_WARN_DAYS) return { kind: "trial_ending", daysLeft };
    return null;
  }

  if (args.subStatus === "VENCIDO") return { kind: "overdue" };
  return null;
}

/**
 * Como a empresa está em relação ao pagamento, nos três grupos que interessam a
 * quem opera o SaaS: quem está experimentando, quem está pagando, e quem não
 * está.
 */
export type SituacaoCobranca = "em_teste" | "em_dia" | "inadimplente";

export interface SituacaoCobrancaDetalhe {
  situacao: SituacaoCobranca;
  /**
   * Status recalculado das datas — NÃO o gravado no banco.
   *
   * O gravado é atualizado pelo cron diário, então entre duas execuções ele
   * mente: uma assinatura que venceu de madrugada continua marcada `ATIVO` até o
   * cron rodar. Numa tela de acompanhamento isso é justamente o erro que importa
   * (o admin veria "em dia" quem já venceu), então aqui a data manda.
   *
   * `null` = empresa sem assinatura nenhuma.
   */
  statusEfetivo: SubscriptionStatus | null;
  /** Dias que faltam do teste. Só em `em_teste`; `null` nos outros casos. */
  diasDeTeste: number | null;
}

/** Por que a pessoa caiu na tela de bloqueio — decide o texto que ela lê. */
export type MotivoBloqueio = "teste_ativo" | "teste_terminou" | "nunca_ativou" | "bloqueado";

/**
 * Traduz a assinatura no motivo do bloqueio, pelas DATAS.
 *
 * A tela decidia por campo cru: `trialEndsAt !== null` era lido como "o teste
 * terminou". Só que quem acaba de confirmar o e-mail recebe essa data no
 * FUTURO — e dá para chegar na tela de bloqueio nesse estado, porque a
 * confirmação grava o trial no banco sem reemitir o cookie, e o proxy decide
 * pelo token. A pessoa lia "Seu teste grátis terminou", com botão para pagar,
 * no primeiro dia de um teste que a tela anterior acabara de anunciar.
 *
 * `teste_ativo` é justamente esse caso: não é cobrança, é sessão velha — o
 * caminho é reemitir o cookie, não pedir dinheiro.
 *
 * Mesma razão de `situacaoCobranca` existir: a classificação sai das datas.
 */
export function motivoDoBloqueio(
  sub:
    | {
        activatedAt: Date | null;
        trialEndsAt: Date | null;
        cancelledAt?: Date | null;
        statusSource?: string | null;
      }
    | null
    | undefined,
  now: Date = new Date(),
  /** `tenant.status === "ACTIVE"`. Empresa bloqueada pelo admin não é "sessão velha". */
  empresaAtiva: boolean = true,
): MotivoBloqueio {
  // Já pagou alguma vez: o bloqueio é de cobrança, não de ativação.
  if (!sub || sub.activatedAt !== null) return "bloqueado";
  // Decisão humana (admin, estorno) vence as datas — como em `computeStatus`.
  // Sem isto, o bloqueio durante o teste lia "seu teste está ativo, entre de
  // novo", e entrar de novo devolvia a esta mesma tela: um laço sem saída.
  if (!empresaAtiva || sub.statusSource === "MANUAL") return "bloqueado";
  if (sub.trialEndsAt === null) return "nunca_ativou";
  // Cancelar durante o teste encerra na hora (Termos §5): é "terminou".
  if (sub.cancelledAt) return "teste_terminou";
  return sub.trialEndsAt > now ? "teste_ativo" : "teste_terminou";
}

/**
 * Classifica a assinatura para acompanhamento.
 *
 * Olha só a ASSINATURA, de propósito: se o super-admin bloqueou a empresa à mão,
 * ela perde o acesso, mas quem paga continua em dia — misturar as duas coisas
 * marcaria como inadimplente um cliente adimplente. Quem responde sobre acesso é
 * `accessDecision`, e as duas informações aparecem separadas na tela.
 */
export function situacaoCobranca(
  sub: Parameters<typeof computeStatus>[0] | null | undefined,
  now: Date = new Date(),
): SituacaoCobrancaDetalhe {
  // Sem assinatura não há o que cobrar nem o que liberar. Não é "em dia".
  if (!sub) return { situacao: "inadimplente", statusEfetivo: null, diasDeTeste: null };

  const statusEfetivo = computeStatus(sub, now);

  if (statusEfetivo === "TRIAL") {
    return {
      situacao: "em_teste",
      statusEfetivo,
      // Override MANUAL pode devolver TRIAL sem data; nesse caso não há contagem.
      diasDeTeste: sub.trialEndsAt ? trialDaysLeft(sub.trialEndsAt, now) : null,
    };
  }

  if (statusEfetivo === "ATIVO") {
    return { situacao: "em_dia", statusEfetivo, diasDeTeste: null };
  }

  // VENCIDO, SUSPENSO, BLOQUEADO e CANCELADO caem aqui. São graus diferentes do
  // mesmo problema — VENCIDO ainda tem tolerância, SUSPENSO já não tem — e o
  // `statusEfetivo` preserva a diferença para a tela mostrar qual é.
  return { situacao: "inadimplente", statusEfetivo, diasDeTeste: null };
}

/**
 * Recalcula o status da assinatura a partir das datas (usado pelo cron e no refresh).
 * Respeita override manual (statusSource = MANUAL).
 *
 * Ordem: MANUAL (estorno/admin) → cancelamento (período pago até o vencimento) →
 * trial / ciclo pago / tolerância.
 *
 * Antes do primeiro pagamento (`activatedAt` nulo) o único acesso possível é o
 * teste grátis, e ele é regido SÓ por `trialEndsAt`:
 *  - trial correndo  → TRIAL (uso ilimitado);
 *  - trial encerrado ou inexistente → SUSPENSO.
 *
 * Dois invariantes que precisam sobreviver a qualquer mudança aqui:
 *  1. `graceDays` NÃO se aplica a quem nunca pagou. A tolerância existe para
 *     cobrir a compensação bancária de um cliente, não para estender o teste.
 *  2. Trial vencido cai em SUSPENSO, nunca em VENCIDO. VENCIDO libera acesso com
 *     aviso — usá-lo aqui daria dias grátis além dos 7 combinados.
 *
 * `currentPeriodEnd` é deliberadamente ignorado enquanto não há `activatedAt`:
 * um valor generoso gravado na criação não pode virar acesso gratuito.
 */
export function computeStatus(
  sub: {
    status: SubscriptionStatus;
    statusSource: StatusSource;
    activatedAt: Date | null;
    trialEndsAt?: Date | null;
    currentPeriodEnd: Date;
    graceDays: number;
    cancelledAt: Date | null;
  },
  now: Date = new Date(),
): SubscriptionStatus {
  // Estorno/chargeback e bloqueio do super-admin vencem o pedido de cancelar:
  // o mês pago deixou de valer (ou a plataforma cortou o acesso).
  if (sub.statusSource === "MANUAL") return sub.status;

  // Termos §5: cancelar interrompe as renovações; o período JÁ PAGO segue até
  // o vencimento. Sem tolerância depois disso — quem cancelou não entra em
  // VENCIDO. Teste grátis e período já vencido encerram na hora.
  if (sub.cancelledAt) {
    if (sub.activatedAt && now <= sub.currentPeriodEnd) return "ATIVO";
    return "CANCELADO";
  }

  // Nunca houve pagamento aprovado: só o teste grátis pode liberar acesso.
  if (!sub.activatedAt) {
    if (sub.trialEndsAt && now <= sub.trialEndsAt) return "TRIAL";
    return "SUSPENSO";
  }

  const graceEnd = new Date(sub.currentPeriodEnd);
  graceEnd.setDate(graceEnd.getDate() + sub.graceDays);

  if (now <= sub.currentPeriodEnd) return "ATIVO";
  if (now <= graceEnd) return "VENCIDO";
  return "SUSPENSO";
}

/**
 * Onde começa o período que um pagamento aprovado compra.
 *
 * - Renovação adiantada (o período ainda corre): no vencimento atual.
 * - Paga DENTRO da tolerância (status VENCIDO, com acesso): também no
 *   vencimento. Recomeçar na data do pagamento dava os dias de tolerância de
 *   graça a cada ciclo — vence 01/10, paga 06/10, próximo vencimento 06/11 em
 *   vez de 01/11, todo mês.
 * - Primeiro pagamento, ou depois de ficar SEM acesso (tolerância esgotada,
 *   estorno, cancelamento): hoje. Os dias bloqueados não são cobrados.
 */
export function inicioDoPeriodoPago(
  sub: {
    activatedAt: Date | null;
    currentPeriodEnd: Date;
    graceDays: number;
    statusSource: StatusSource;
    cancelledAt: Date | null;
  },
  now: Date = new Date(),
): Date {
  if (sub.currentPeriodEnd > now) return new Date(sub.currentPeriodEnd);
  if (!sub.activatedAt || sub.statusSource === "MANUAL" || sub.cancelledAt) return now;
  const graceEnd = new Date(sub.currentPeriodEnd);
  graceEnd.setDate(graceEnd.getDate() + sub.graceDays);
  return now <= graceEnd ? new Date(sub.currentPeriodEnd) : now;
}
