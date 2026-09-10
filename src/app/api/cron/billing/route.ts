import { timingSafeEqual } from "node:crypto";
import { BillingService } from "@/lib/services/billing.service";
import { gerarRecorrentesDeTodosOsTenants } from "@/lib/services/despesas.service";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { purgeExpiredRateLimits } from "@/lib/security/rate-limit-db";
import { purgeDeadRefreshTokens } from "@/lib/auth/refresh";
import { describeError, logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 60 s, o teto do plano Hobby.
 *
 * Necessário desde que a importação dos boletins passou a rodar aqui: ela fala
 * com um site externo lento, e o padrão da função serverless (~10 s) a mataria no
 * meio de uma gravação. O orçamento passado ao serviço é calculado a partir do
 * tempo que o billing já gastou, justamente para parar ANTES deste teto — ser
 * morto pela plataforma deixaria a central pela metade e sem registro nenhum.
 */
export const maxDuration = 60;

/** Teto de tempo desta função, com folga para a resposta sair. */
const ORCAMENTO_DA_ROTA_MS = 45_000;
/** Abaixo disto não vale começar: não dá para importar praça nenhuma. */
const MINIMO_PARA_IMPORTAR_MS = 5_000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || !auth) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(auth);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Cron diário de billing:
 *  1. reconcilia cobranças no Mercado Pago (cura webhook perdido, nos dois sentidos);
 *  2. recalcula o status das assinaturas (ATIVO/VENCIDO/SUSPENSO);
 *  3. avisa por e-mail quem vence nos próximos dias;
 *  4. gera as parcelas das despesas fixas marcadas como "repetir todo mês";
 *  5. limpa as janelas de rate limit já vencidas (só higiene de tabela);
 *  6. por último, importa os boletins de cotação.
 * A ordem importa: reconciliar antes evita suspender quem já pagou, e recalcular
 * antes do aviso evita mandar "vence em 3 dias" para quem acabou de pagar.
 * Protegido por CRON_SECRET. Configurado em vercel.json.
 */
async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  const comecou = Date.now();
  try {
    const reconciliacao = await BillingService.reconcilePendingPayments();
    const statuses = await BillingService.recomputeStatuses();
    // Depois do recálculo: quem acabou de ser reativado por um pagamento
    // reconciliado não deve receber aviso de vencimento no mesmo minuto.
    // Não pode derrubar o cron — a cobrança em si não depende do e-mail.
    const lembretes = await BillingService.enviarLembretesDeVencimento().catch((e) => {
      logger.error({ err: describeError(e) }, "Falha ao enviar lembretes de vencimento");
      return { candidatos: 0, enviados: 0 };
    });
    // Despesas recorrentes: quem não deu baixa no aluguel não deve perder a
    // conta do mês seguinte. Falhar aqui não afeta a cobrança da plataforma.
    const despesasRecorrentes = await gerarRecorrentesDeTodosOsTenants().catch((e) => {
      logger.error({ err: describeError(e) }, "Falha ao gerar despesas recorrentes");
      return { empresas: 0, geradas: 0 };
    });
    // Não pode derrubar o cron: as linhas vencidas são inertes de qualquer forma.
    const rateLimitsRemovidos = await purgeExpiredRateLimits().catch(() => 0);
    // Idem para as sessões mortas: cada login e cada renovação deixam uma linha,
    // e nada as apagava. Falhar aqui não afeta cobrança nenhuma.
    const sessoesRemovidas = await purgeDeadRefreshTokens().catch(() => 0);

    /*
      Importação dos boletins de cotação — POR ÚLTIMO, e não por acaso.

      Este cron roda 16:30 UTC = 13:30 BRT. O horário é o motivo de a importação
      estar aqui: no cron de avisos, que sai 06:30 BRT, a praça ainda não havia
      publicado o boletim do dia, e o recuo de datas trazia sempre o de ontem —
      o preço de hoje só chegava na manhã seguinte. O plano Hobby limita a dois
      agendamentos, então não havia um terceiro horário a pedir; a saída foi
      trocar de carona.

      A regra que separou as duas rotas continua valendo, e é ela que dita a
      posição: cobrança é receita, raspagem de site de terceiro é conveniência.
      Então a raspagem roda DEPOIS de tudo que envolve dinheiro já estar
      commitado, com `.catch()` próprio, e com orçamento calculado a partir do
      tempo que o billing já consumiu. O dia em que a fonte cair não pode ser o
      dia em que a assinatura de alguém não é reconciliada.
    */
    const restante = ORCAMENTO_DA_ROTA_MS - (Date.now() - comecou);
    const cotacoes =
      restante < MINIMO_PARA_IMPORTAR_MS
        ? { pulado: "sem tempo no orcamento da rota" }
        : await CotacoesImportService.importarTodasAsCentrais({ orcamentoMs: restante })
            .then(async (r) => {
              // A defasagem é conferida DEPOIS de importar: assim ela enxerga o
              // resultado desta execução, e não o de ontem.
              const defasadas = await CotacoesImportService.verificarDefasagem();
              return { centrais: r.centrais, defasadas: defasadas.length };
            })
            .catch((e) => {
              logger.error({ err: describeError(e) }, "Importacao de cotacoes falhou");
              return { erro: "falhou" };
            });
    logger.info({ cotacoes }, "Sub-tarefa de cotacoes concluida");

    return Response.json({
      ok: true,
      reconciliacao,
      statuses,
      lembretes,
      despesasRecorrentes,
      rateLimitsRemovidos,
      sessoesRemovidas,
      cotacoes,
    });
  } catch (e) {
    logger.error({ err: describeError(e) }, "Erro no cron de billing");
    return Response.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
