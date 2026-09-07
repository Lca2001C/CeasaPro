import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { slugProduto } from "@/lib/cotacoes/nome";
import { frescorDoBoletim } from "@/lib/cotacoes/frescor";
import { fontePara, type FonteDeCotacao } from "@/lib/cotacoes/fontes";
import { AdminNotificationsService } from "./admin-notifications.service";
import { NotFoundError } from "@/lib/http/app-error";
import type { LinhaDeCotacao } from "@/lib/cotacoes/csv";

/** Quantos dias para trás tentar quando o dia de hoje não tem boletim. */
const MAX_DIAS_DE_RECUO = 3;
/** Respiro entre centrais: rajada de um IP só contra PHP legado vira bloqueio. */
const PAUSA_ENTRE_CENTRAIS_MS = 2_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ResultadoDaImportacao {
  status: "OK" | "VAZIO" | "FALHA" | "SEM_FONTE";
  centralCode: string;
  cotacoesGravadas: number;
  quoteDate?: Date;
  erro?: string;
}

/**
 * Gravação de boletim.
 *
 * Um caminho só, usado pela importação manual (CSV colado no painel) e — quando
 * a Etapa B chegar — pelo adaptador automático. Isso é deliberado: se o caminho
 * manual gravasse diferente do automático, a tela do cliente mostraria coisas
 * sutilmente diferentes conforme a origem do dado, e ninguém descobriria por quê.
 */

export interface ResultadoDaGravacao {
  runId: string;
  quoteDate: Date;
  produtosNovos: number;
  cotacoesGravadas: number;
}

export const CotacoesImportService = {
  /**
   * Grava um boletim inteiro, de forma idempotente.
   *
   * Reimportar o mesmo dia ATUALIZA as linhas em vez de duplicar — é o que a
   * chave única `(central, data, produto, unidade)` garante, e é o que permite
   * corrigir um boletim colado errado simplesmente colando de novo.
   */
  async gravar(params: {
    centralCode: string;
    quoteDate: Date;
    linhas: LinhaDeCotacao[];
    sourceKey: string;
    fingerprint?: string | null;
  }): Promise<ResultadoDaGravacao> {
    const { centralCode, quoteDate, linhas, sourceKey } = params;
    const inicio = Date.now();

    const central = await prisma.ceasaCentral.findUnique({
      where: { code: centralCode },
      select: { code: true },
    });
    if (!central) throw new NotFoundError("Central não encontrada.");

    // Normaliza a data para meia-noite UTC: a coluna é DATE, e mandar um
    // instante faria o Postgres truncar de um jeito que depende do fuso da
    // conexão.
    const data = new Date(
      Date.UTC(quoteDate.getUTCFullYear(), quoteDate.getUTCMonth(), quoteDate.getUTCDate()),
    );

    let produtosNovos = 0;
    let cotacoesGravadas = 0;

    for (const linha of linhas) {
      const slug = slugProduto(linha.produto);
      if (!slug) continue;

      const existente = await prisma.ceasaProduct.findUnique({
        where: { slug },
        select: { id: true },
      });
      const produto = existente
        ? await prisma.ceasaProduct.update({
            where: { id: existente.id },
            data: { lastSeenAt: new Date(), active: true },
            select: { id: true },
          })
        : await prisma.ceasaProduct.create({
            data: { name: linha.produto, slug },
            select: { id: true },
          });
      if (!existente) produtosNovos++;

      await prisma.ceasaQuote.upsert({
        where: {
          centralCode_quoteDate_ceasaProductId_unit: {
            centralCode,
            quoteDate: data,
            ceasaProductId: produto.id,
            unit: linha.unidade,
          },
        },
        create: {
          centralCode,
          quoteDate: data,
          ceasaProductId: produto.id,
          unit: linha.unidade,
          minPrice: linha.minimo,
          avgPrice: linha.comum,
          maxPrice: linha.maximo,
          refPrice: linha.referencia,
        },
        update: {
          minPrice: linha.minimo,
          avgPrice: linha.comum,
          maxPrice: linha.maximo,
          refPrice: linha.referencia,
          importedAt: new Date(),
        },
      });
      cotacoesGravadas++;
    }

    const run = await prisma.ceasaImportRun.create({
      data: {
        centralCode,
        sourceKey,
        quoteDate: data,
        // Boletim sem linha nenhuma é VAZIO, não FALHA: domingo e feriado caem
        // aqui, e chamá-los de falha ensinaria o operador a ignorar o alarme.
        status: linhas.length > 0 ? "OK" : "VAZIO",
        rowsParsed: linhas.length,
        rowsUpserted: cotacoesGravadas,
        durationMs: Date.now() - inicio,
        fingerprint: params.fingerprint ?? null,
        finishedAt: new Date(),
      },
      select: { id: true },
    });

    logger.info(
      { centralCode, sourceKey, cotacoesGravadas, produtosNovos },
      "Boletim de cotações gravado",
    );

    return { runId: run.id, quoteDate: data, produtosNovos, cotacoesGravadas };
  },

  /**
   * Importa o boletim de UMA central.
   *
   * `fonteInjetada` existe para o teste: injetar uma fonte falsa é mais honesto
   * que mockar módulo, e mantém o teste falando com o código de verdade.
   *
   * **Recuo de datas.** Tenta hoje, ontem, anteontem — no máximo
   * `MAX_DIAS_DE_RECUO` requisições — até vir boletim com linhas. Sem isso, um
   * feriado emendado ou o boletim do dia ainda não publicado deixariam a tela
   * vazia mesmo havendo dado de dois dias atrás. A tela mostra a data do que
   * veio, então recuar não engana ninguém.
   */
  async importarCentral(
    centralCode: string,
    opts: { agora?: Date; fonteInjetada?: FonteDeCotacao } = {},
  ): Promise<ResultadoDaImportacao> {
    const agora = opts.agora ?? new Date();
    const central = await prisma.ceasaCentral.findUnique({
      where: { code: centralCode },
      select: { code: true, name: true, sourceKey: true, sourceParams: true, active: true },
    });
    if (!central) throw new NotFoundError("Central não encontrada.");

    const fonte = opts.fonteInjetada ?? fontePara(central.sourceKey);
    if (!fonte) {
      // Central alimentada à mão (`sourceKey: "manual"`) não tem o que buscar.
      // Pular é o certo: tentar registraria falha todo dia e afogaria o alarme.
      return { status: "SEM_FONTE", centralCode, cotacoesGravadas: 0 };
    }

    let ultimoErro: string | undefined;
    for (let recuo = 0; recuo < MAX_DIAS_DE_RECUO; recuo++) {
      const dia = new Date(
        Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() - recuo),
      );
      const r = await fonte.buscar({ sourceParams: central.sourceParams, data: dia });

      if (!r.ok) {
        ultimoErro = r.erro ?? "falha desconhecida";
        await registrarFalha(central.code, fonte.chave, dia, ultimoErro, r.httpStatus);
        await avisarFalha(central.name, ultimoErro);
        return { status: "FALHA", centralCode, cotacoesGravadas: 0, erro: ultimoErro };
      }

      if (r.vazio) continue; // dia sem boletim: tenta o anterior, sem alarme

      const gravado = await this.gravar({
        centralCode: central.code,
        quoteDate: dia,
        linhas: r.linhas,
        sourceKey: fonte.chave,
        fingerprint: r.fingerprint ?? null,
      });

      await conferirFingerprint(central, fonte.chave, r.fingerprint ?? null, gravado.runId);

      return {
        status: "OK",
        centralCode,
        cotacoesGravadas: gravado.cotacoesGravadas,
        quoteDate: gravado.quoteDate,
      };
    }

    // Nenhum dos dias tinha boletim. Não é falha — é o que acontece num feriado
    // emendado. O alarme de defasagem cuida do caso em que isso PERSISTE.
    await prisma.ceasaImportRun.create({
      data: {
        centralCode: central.code,
        sourceKey: fonte.chave,
        status: "VAZIO",
        finishedAt: new Date(),
      },
    });
    return { status: "VAZIO", centralCode, cotacoesGravadas: 0 };
  },

  /**
   * Importa só as centrais que ALGUM cliente realmente usa.
   *
   * Não se martela um site público por dado que ninguém lê, e assim o orçamento
   * de requisições cresce com a base de clientes, não com o catálogo.
   *
   * Sequencial, com pausa entre centrais: sete requisições simultâneas de um IP
   * de datacenter contra um PHP legado é como se consegue um bloqueio.
   */
  async importarTodasAsCentrais(opts: { agora?: Date; fonteInjetada?: FonteDeCotacao } = {}) {
    const emUso = await prisma.tenant.findMany({
      where: { deletedAt: null, ceasaCentralCode: { not: null } },
      distinct: ["ceasaCentralCode"],
      select: { ceasaCentralCode: true },
    });
    const codigos = emUso.map((t) => t.ceasaCentralCode!).filter(Boolean);
    if (codigos.length === 0) return { centrais: 0, resultados: [] as ResultadoDaImportacao[] };

    const ativas = await prisma.ceasaCentral.findMany({
      where: { code: { in: codigos }, active: true },
      orderBy: { sortOrder: "asc" },
      select: { code: true },
    });

    const resultados: ResultadoDaImportacao[] = [];
    for (const [i, c] of ativas.entries()) {
      if (i > 0) await dormir(PAUSA_ENTRE_CENTRAIS_MS);
      try {
        resultados.push(await this.importarCentral(c.code, opts));
      } catch (e) {
        // Uma central quebrada não pode derrubar as outras.
        const erro = e instanceof Error ? e.message : String(e);
        logger.error({ centralCode: c.code, err: erro }, "Importação de central estourou");
        resultados.push({ status: "FALHA", centralCode: c.code, cotacoesGravadas: 0, erro });
      }
    }
    return { centrais: ativas.length, resultados };
  },

  /**
   * Alarme de defasagem — o único que um bug nos outros não desarma.
   *
   * As camadas anteriores (erro da fonte, fingerprint) dependem de o código
   * chegar até elas. Esta olha só o resultado: uma central COM CLIENTES está sem
   * boletim novo há mais de `DIAS_ATE_DEFASAGEM` dias? Então algo está errado, e
   * não importa o quê — rede, formato, central desativada por engano, ou defeito
   * na própria detecção de falha.
   *
   * É o mesmo limiar que a tela do cliente usa para o selo, importado do mesmo
   * lugar: se divergissem, a tela diria que está tudo bem enquanto o alarme
   * gritaria.
   */
  async verificarDefasagem(agora = new Date()) {
    const centrais = await prisma.ceasaCentral.findMany({
      where: { active: true, tenants: { some: { deletedAt: null } } },
      select: { code: true, name: true },
    });

    const defasadas: { code: string; name: string; dias: number | null }[] = [];
    for (const c of centrais) {
      const ultimo = await prisma.ceasaQuote.aggregate({
        where: { centralCode: c.code },
        _max: { quoteDate: true },
      });
      const f = frescorDoBoletim(ultimo._max.quoteDate, agora);
      if (f.nivel === "defasado" || f.nivel === "ausente") {
        defasadas.push({ code: c.code, name: c.name, dias: f.dias });
      }
    }

    for (const d of defasadas) {
      await AdminNotificationsService.criar({
        kind: "COTACOES_DESATUALIZADAS",
        title: `Cotações desatualizadas — ${d.name}`,
        body:
          d.dias === null
            ? `A central ${d.name} tem clientes e nunca recebeu boletim.`
            : `A central ${d.name} tem clientes e está sem boletim novo há ${d.dias} dias.`,
        href: "/admin/cotacoes",
      });
    }
    return defasadas;
  },

  /** Situação de cada central, para a tela do super-admin. */
  async situacaoDasCentrais() {
    const centrais = await prisma.ceasaCentral.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { code: true, name: true, city: true, uf: true, active: true, sourceKey: true },
    });

    const [ultimasExecucoes, ultimosBoletins, empresas] = await Promise.all([
      prisma.ceasaImportRun.findMany({
        orderBy: { startedAt: "desc" },
        distinct: ["centralCode"],
        select: {
          centralCode: true,
          status: true,
          rowsUpserted: true,
          error: true,
          startedAt: true,
        },
      }),
      prisma.ceasaQuote.groupBy({
        by: ["centralCode"],
        _max: { quoteDate: true },
      }),
      prisma.tenant.groupBy({
        by: ["ceasaCentralCode"],
        where: { deletedAt: null, ceasaCentralCode: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const porExecucao = new Map(ultimasExecucoes.map((r) => [r.centralCode, r]));
    const porBoletim = new Map(ultimosBoletins.map((r) => [r.centralCode, r._max.quoteDate]));
    const porEmpresa = new Map(empresas.map((r) => [r.ceasaCentralCode!, r._count._all]));

    return centrais.map((c) => ({
      ...c,
      clientes: porEmpresa.get(c.code) ?? 0,
      ultimoBoletim: porBoletim.get(c.code) ?? null,
      ultimaExecucao: porExecucao.get(c.code) ?? null,
    }));
  },
};

/** Registra a tentativa que falhou — é o histórico que a tela do admin mostra. */
async function registrarFalha(
  centralCode: string,
  sourceKey: string,
  quoteDate: Date,
  erro: string,
  httpStatus?: number,
) {
  await prisma.ceasaImportRun.create({
    data: {
      centralCode,
      sourceKey,
      quoteDate,
      status: "FALHA",
      error: erro.slice(0, 500),
      httpStatus: httpStatus ?? null,
      finishedAt: new Date(),
    },
  });
  logger.error({ centralCode, sourceKey, err: erro }, "Falha ao importar boletim");
}

/**
 * Avisa o super-admin, sem deixar a falha do aviso derrubar a importação.
 *
 * O serviço de notificação já engole os próprios erros, mas o `catch` aqui é
 * barato e mantém a regra: a tarefa acessória nunca derruba a principal.
 */
async function avisarFalha(nomeDaCentral: string, erro: string) {
  await AdminNotificationsService.criar({
    kind: "COTACOES_FALHA",
    title: `Falha ao importar cotações — ${nomeDaCentral}`,
    body: `A importação do boletim de ${nomeDaCentral} falhou: ${erro.slice(0, 300)}`,
    href: "/admin/cotacoes",
  }).catch(() => {});
}

/**
 * Compara a assinatura estrutural com a da última importação bem-sucedida.
 *
 * Dispara aviso MESMO com o parsing tendo dado certo. É a única camada que pega
 * a fonte trocando as colunas de lugar: nesse caso não há erro, não há página
 * vazia, o cron fica verde, e o preço mostrado passa a ser de outro campo.
 */
async function conferirFingerprint(
  central: { code: string; name: string },
  sourceKey: string,
  atual: string | null,
  runIdAtual: string,
) {
  if (!atual) return;
  const anterior = await prisma.ceasaImportRun.findFirst({
    where: {
      centralCode: central.code,
      sourceKey,
      status: "OK",
      fingerprint: { not: null },
      id: { not: runIdAtual },
    },
    orderBy: { startedAt: "desc" },
    select: { fingerprint: true },
  });
  if (!anterior?.fingerprint || anterior.fingerprint === atual) return;

  logger.warn(
    { centralCode: central.code, anterior: anterior.fingerprint, atual },
    "Estrutura do boletim mudou",
  );
  await AdminNotificationsService.criar({
    kind: "COTACOES_FALHA",
    title: `Formato do boletim mudou — ${central.name}`,
    body:
      `A estrutura da resposta de ${central.name} mudou desde a última importação. ` +
      "Os dados foram gravados, mas confira se as colunas ainda são as mesmas — " +
      "uma coluna trocada faz o preço errado aparecer como certo.",
    href: "/admin/cotacoes",
  }).catch(() => {});
}
