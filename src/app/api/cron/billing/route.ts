import { timingSafeEqual } from "node:crypto";
import { BillingService } from "@/lib/services/billing.service";
import { gerarRecorrentesDeTodosOsTenants } from "@/lib/services/despesas.service";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { NoticiasService } from "@/lib/services/noticias.service";
import { ProdutoImagemService } from "@/lib/services/produto-imagem.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { purgeExpiredRateLimits } from "@/lib/security/rate-limit-db";
import { purgeDeadRefreshTokens } from "@/lib/auth/refresh";
import { describeError, logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 60 s.
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
/**
 * Fatia da reconciliação no orçamento da rota. É a única etapa que fala com o
 * Mercado Pago em volume: sem teto, ela consumia os 60 s sozinha e o que vem
 * depois (status, lembretes, despesas, limpezas, boletins) nunca rodava. O que
 * não couber hoje vai primeiro amanhã (rotação por `lastReconciledAt`). Cada
 * consulta tem prazo próprio de 8 s, então o pior caso fica perto de 28 s.
 */
const ORCAMENTO_RECONCILIACAO_MS = 20_000;
/** Fatia dos checkpoints do custo médio; o que não couber vai primeiro amanhã. */
const ORCAMENTO_CHECKPOINTS_MS = 8_000;
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
 *  5. limpa as janelas de rate limit já vencidas (só higiene de tabela) e
 *     avança os checkpoints do custo médio do estoque;
 *  6. por último, importa os boletins de cotação.
 * A ordem importa: reconciliar antes evita suspender quem já pagou, e recalcular
 * antes do aviso evita mandar "vence em 3 dias" para quem acabou de pagar.
 * Por isso a reconciliação continua primeiro — mas com ORÇAMENTO próprio e sem
 * poder derrubar o resto: as etapas locais são baratas e não podem passar fome
 * esperando o gateway.
 * Protegido por CRON_SECRET. Configurado em vercel.json.
 */
async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  const comecou = Date.now();
  try {
    const reconciliacao = await BillingService.reconcilePendingPayments({
      orcamentoMs: ORCAMENTO_RECONCILIACAO_MS,
    }).catch((e) => {
      // Falhar a reconciliação (banco, gateway fora) não pode levar junto o
      // recálculo de status: ele é o que suspende quem venceu e libera quem
      // está em dia pelas datas, e não depende do Mercado Pago.
      logger.error({ err: describeError(e) }, "Falha na reconciliação com o Mercado Pago");
      return { erro: "falhou" as const };
    });
    // Com `.catch()` próprio: sem ele, um erro aqui virava 500 ANTES dos
    // boletins — a importação e o alarme de defasagem não rodavam, e o dia
    // passava sem preço novo e sem ninguém avisado. A falha continua visível:
    // a resposta sai 500 no fim.
    const statuses = await BillingService.recomputeStatuses().catch((e) => {
      logger.error({ err: describeError(e) }, "Falha ao recalcular status das assinaturas");
      return { erro: "falhou" as const };
    });
    const statusFalhou = "erro" in statuses;
    // Depois do recálculo: quem acabou de ser reativado por um pagamento
    // reconciliado não deve receber aviso de vencimento no mesmo minuto — e,
    // se o recálculo falhou, o aviso partiria de status velho, então não sai.
    // Não pode derrubar o cron — a cobrança em si não depende do e-mail.
    const lembretes = statusFalhou
      ? { pulado: "status nao recalculado" }
      : await BillingService.enviarLembretesDeVencimento().catch((e) => {
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
    // Checkpoints do custo médio: sem eles cada venda relê o livro-razão inteiro
    // do produto. Tabela derivada — atrasar um dia só deixa a conta mais cara,
    // nunca errada —, então tem teto de tempo e não derruba nada.
    const checkpointsDeCusto = await EstoqueService.atualizarCheckpointsDeTodos({
      prazo: Date.now() + ORCAMENTO_CHECKPOINTS_MS,
    }).catch((e) => {
      logger.error({ err: describeError(e) }, "Falha ao atualizar checkpoints de custo");
      return { erro: "falhou" as const };
    });

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
        ? // Sem tempo para importar, o alarme de defasagem roda mesmo assim
          // (é uma consulta local): é ele que avisa que a praça está parada —
          // pular os dois juntos era o jeito de o problema ficar invisível.
          await CotacoesImportService.verificarDefasagem()
            .then((d) => ({ pulado: "sem tempo no orcamento da rota", defasadas: d.length }))
            .catch((e) => {
              logger.error({ err: describeError(e) }, "Verificacao de defasagem falhou");
              return { pulado: "sem tempo no orcamento da rota", erro: "falhou" };
            })
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

    // CeasaNews: a mesma regra das cotações — conveniência, por último, com
    // orçamento do que sobrou e `.catch()` próprio. A tela também coleta sob
    // demanda; aqui é a garantia de uma coleta por dia mesmo sem visita.
    const restanteNoticias = ORCAMENTO_DA_ROTA_MS - (Date.now() - comecou);
    const noticias =
      restanteNoticias < MINIMO_PARA_IMPORTAR_MS
        ? { pulado: "sem tempo no orcamento da rota" }
        : await NoticiasService.coletar({ prazo: Date.now() + restanteNoticias }).catch((e) => {
            logger.error({ err: describeError(e) }, "Coleta do CeasaNews falhou");
            return { erro: "falhou" };
          });

    // Fotos de produto que ninguém usa (formulário abandonado): higiene do
    // bucket, a última da fila e com o tempo que sobrou.
    const restanteFotos = ORCAMENTO_DA_ROTA_MS - (Date.now() - comecou);
    const fotosOrfas =
      restanteFotos < 2_000
        ? { pulado: "sem tempo no orcamento da rota" }
        : await ProdutoImagemService.limparOrfas({ prazo: Date.now() + restanteFotos }).catch(
            (e) => {
              logger.error({ err: describeError(e) }, "Limpeza de fotos órfãs falhou");
              return { erro: "falhou" };
            },
          );

    return Response.json(
      {
        ok: !statusFalhou,
        reconciliacao,
        statuses,
        lembretes,
        despesasRecorrentes,
        rateLimitsRemovidos,
        sessoesRemovidas,
        checkpointsDeCusto,
        cotacoes,
        noticias,
        fotosOrfas,
      },
      { status: statusFalhou ? 500 : 200 },
    );
  } catch (e) {
    logger.error({ err: describeError(e) }, "Erro no cron de billing");
    return Response.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
