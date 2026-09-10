
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { slugProduto } from "@/lib/cotacoes/nome";
import { frescorDoBoletim } from "@/lib/cotacoes/frescor";
import { civilParts } from "@/lib/tz";
import { fontePara, type FonteDeCotacao } from "@/lib/cotacoes/fontes";
import { AdminNotificationsService } from "./admin-notifications.service";
import { NotFoundError } from "@/lib/http/app-error";
import type { LinhaDeCotacao } from "@/lib/cotacoes/csv";
import { serieDaFonte } from "@/lib/cotacoes/serie";

// Reexportada para não quebrar quem já a importava daqui. A definição saiu
// deste arquivo e mora em `lib/cotacoes/serie.ts` — o comentário lá explica
// por quê: importá-la daqui arrasta o raspador junto.
export { serieDaFonte };

/**
 * Quantos dias para trás tentar quando o dia de hoje não tem boletim.
 *
 * Sete, não três. Medido contra a fonte: Juiz de Fora, Barbacena, Caratinga e
 * Poços de Caldas publicam 2 a 3 vezes por semana, com intervalos de até 4 dias
 * (sexta a terça, por exemplo). Com recuo de 3, a importação dessas unidades
 * voltaria VAZIA em boa parte dos dias mesmo havendo boletim recente — e a tela
 * do cliente ficaria sem preço nenhum sem que nada estivesse quebrado.
 *
 * O custo de recuar mais é só requisição a mais nos dias sem boletim, e o laço
 * para na primeira data que retorna dado.
 */
const MAX_DIAS_DE_RECUO = 7;
/** Respiro entre centrais: rajada de um IP só contra PHP legado vira bloqueio. */
const PAUSA_ENTRE_CENTRAIS_MS = 2_000;
/**
 * Teto de tempo da rodada inteira.
 *
 * A função serverless da Vercel tem duração máxima (60 s no plano Hobby, com
 * `maxDuration`). Parar sozinho antes disso é o que transforma "não deu tempo
 * hoje" em algo visível e recuperável, em vez de a plataforma matar a função no
 * meio de uma gravação.
 */
const ORCAMENTO_PADRAO_MS = 40_000;

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
    const serie = serieDaFonte(sourceKey);

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

    /*
      Gravação em LOTE, e não linha a linha.

      A primeira versão fazia três idas ao banco por linha (procurar o produto,
      criar/atualizar, gravar a cotação). Medido contra um boletim real de 215
      linhas: 1,6 s por central com o Postgres em localhost. Em produção o banco
      é o Neon (rede + pgbouncer) e são sete centrais, o que põe o cron muito
      além do teto de 10 s da função serverless — e a importação morreria pela
      metade, todo dia, sem erro nenhum aparecendo.

      Isto reduz as ~645 idas a meia dúzia. `createMany` com `skipDuplicates`
      também resolve, de quebra, uma corrida real: a versão anterior fazia
      "procura, não achou, cria", e duas execuções simultâneas do cron (retry da
      Vercel) estourariam violação de chave única no meio do laço.

      SEM transação interativa, de propósito. Em produção o banco fica atrás do
      pgbouncer em modo transaction, onde `$transaction` interativa é justamente
      o que dá problema. E não faz falta: se o processo morrer entre a criação
      dos produtos e a gravação das cotações, sobram produtos de catálogo sem
      cotação — inertes, e a próxima execução os reaproveita e completa o
      serviço. O estado intermediário não mente para ninguém.
    */
    const porChave = new Map<string, { slug: string; linha: LinhaDeCotacao }>();
    for (const linha of linhas) {
      const slug = slugProduto(linha.produto);
      if (!slug) continue;
      // O próprio boletim pode repetir a mesma dupla produto+unidade. Sem esta
      // deduplicação, o INSERT em lote falharia com "ON CONFLICT DO UPDATE
      // command cannot affect row a second time".
      porChave.set(`${slug}|${linha.unidade}`, { slug, linha });
    }
    const itens = [...porChave.values()];
    if (itens.length === 0) {
      return { runId: await registrarRun(centralCode, sourceKey, data, 0, 0, inicio, params.fingerprint), quoteDate: data, produtosNovos: 0, cotacoesGravadas: 0 };
    }

    /*
      Toda leitura e escrita de produto é FILTRADA POR SÉRIE.

      Sem isso o `serie` no schema seria decoração: "UVA ITALIA" da praça e da
      série nacional têm nome e unidade idênticos, e sem o filtro a busca por
      slug traria o produto da OUTRA taxonomia — as cotações do boletim iriam
      parar no produto genérico, e a chave única de `ceasa_quotes` voltaria a
      colidir exatamente como antes.
    */
    const slugsUnicos = [...new Set(itens.map((i) => i.slug))];
    const jaExistiam = await prisma.ceasaProduct.findMany({
      where: { serie, slug: { in: slugsUnicos } },
      select: { slug: true },
    });
    const conhecidos = new Set(jaExistiam.map((p) => p.slug));

    const novos = itens
      .filter((i) => !conhecidos.has(i.slug))
      .map((i) => ({ name: i.linha.produto, slug: i.slug, serie }));
    // Deduplica por slug: dois nomes diferentes podem normalizar para o mesmo.
    const novosUnicos = [...new Map(novos.map((n) => [n.slug, n])).values()];
    if (novosUnicos.length > 0) {
      await prisma.ceasaProduct.createMany({ data: novosUnicos, skipDuplicates: true });
    }
    const produtosNovos = novosUnicos.length;

    await prisma.ceasaProduct.updateMany({
      where: { serie, slug: { in: slugsUnicos } },
      data: { lastSeenAt: new Date(), active: true },
    });

    const todos = await prisma.ceasaProduct.findMany({
      where: { serie, slug: { in: slugsUnicos } },
      select: { id: true, slug: true },
    });
    const idPorSlug = new Map(todos.map((p) => [p.slug, p.id]));

    const agora = new Date();
    const valores = itens
      .map(({ slug, linha }) => {
        const id = idPorSlug.get(slug);
        if (!id) return null;
        return Prisma.sql`(${centralCode}, ${id}, ${data}, ${linha.unidade},
          ${linha.minimo}, ${linha.comum}, ${linha.maximo}, ${linha.referencia}, ${agora})`;
      })
      .filter((v): v is Prisma.Sql => v !== null);

    // Um único INSERT para o boletim inteiro. `ON CONFLICT` mantém a
    // idempotência: reimportar o mesmo dia corrige em vez de duplicar.
    const cotacoesGravadas = await prisma.$executeRaw`
      INSERT INTO ceasa_quotes
        ("centralCode", "ceasaProductId", "quoteDate", "unit",
         "minPrice", "avgPrice", "maxPrice", "refPrice", "importedAt")
      VALUES ${Prisma.join(valores)}
      ON CONFLICT ("centralCode", "quoteDate", "ceasaProductId", "unit")
      DO UPDATE SET
        "minPrice"   = EXCLUDED."minPrice",
        "avgPrice"   = EXCLUDED."avgPrice",
        "maxPrice"   = EXCLUDED."maxPrice",
        "refPrice"   = EXCLUDED."refPrice",
        "importedAt" = EXCLUDED."importedAt"
    `;

    const runId = await registrarRun(
      centralCode,
      sourceKey,
      data,
      linhas.length,
      cotacoesGravadas,
      inicio,
      params.fingerprint,
    );

    logger.info(
      { centralCode, sourceKey, cotacoesGravadas, produtosNovos, ms: Date.now() - inicio },
      "Boletim de cotações gravado",
    );

    return { runId, quoteDate: data, produtosNovos, cotacoesGravadas };
  },

  /**
   * Apaga o boletim de uma praça em UMA data. O desfazer que faltava.
   *
   * Por que isto precisa existir, e por que a falta doía mais do que parecia:
   * `gravar` termina em `ON CONFLICT DO UPDATE`, então é primitiva de
   * SOBRESCRITA. Um boletim colado com a coluna errada, ou com o preço de uma
   * praça no código de outra, ficava gravado — e como toda leitura parte de
   * `MAX(quoteDate)`, o jeito de "corrigir" era esperar um boletim com data
   * posterior. Numa praça manual (57 das 66 do catálogo) isso não acontece
   * sozinho: o dado errado era o preço oficial daquela praça para todos os
   * clientes dela, indefinidamente, e a única saída era SQL na produção.
   *
   * Só o super-admin chega aqui. Apaga as cotações daquele dia e as execuções de
   * importação daquele dia — as duas, porque deixar a run para trás faria
   * `/admin/cotacoes` continuar afirmando "importado com sucesso" para um dia que
   * não tem mais preço nenhum.
   *
   * NÃO apaga `ceasa_products`: o catálogo é global e compartilhado entre praças
   * e datas, então remover um produto por causa de um boletim ruim derrubaria os
   * vínculos que outros clientes fizeram com ele. Produto que só existiu naquele
   * boletim fica no catálogo sem cotação, que é inerte — `getTelaDeVinculo` só
   * oferece o que a praça de fato cota.
   */
  async apagarBoletim(centralCode: string, quoteDate: Date) {
    // A data chega da tela como início do dia no fuso do app; a coluna é
    // `@db.Date`, e é assim que `gravar` normaliza. Sem isto, um fuso negativo
    // apagaria o dia errado.
    const dia = new Date(
      Date.UTC(quoteDate.getUTCFullYear(), quoteDate.getUTCMonth(), quoteDate.getUTCDate()),
    );

    const cotacoes = await prisma.ceasaQuote.deleteMany({
      where: { centralCode, quoteDate: dia },
    });
    const execucoes = await prisma.ceasaImportRun.deleteMany({
      where: { centralCode, quoteDate: dia },
    });

    logger.warn(
      { centralCode, quoteDate: dia.toISOString().slice(0, 10), cotacoes: cotacoes.count },
      "Boletim de cotações APAGADO",
    );
    return { cotacoesApagadas: cotacoes.count, execucoesApagadas: execucoes.count };
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
      // O dia é o BRASILEIRO, não o do servidor. O cron roda em UTC; entre 21h e
      // meia-noite no Brasil o "hoje" em UTC já é amanhã, e a primeira tentativa
      // pediria à fonte um boletim do futuro — gastando uma requisição e
      // recuando um dia a menos do que devia.
      const hoje = civilParts(agora);
      const dia = new Date(Date.UTC(hoje.year, hoje.month - 1, hoje.day - recuo));
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
  async importarTodasAsCentrais(
    opts: { agora?: Date; fonteInjetada?: FonteDeCotacao; orcamentoMs?: number } = {},
  ) {
    const inicio = Date.now();
    const orcamento = opts.orcamentoMs ?? ORCAMENTO_PADRAO_MS;

    const emUso = await prisma.tenant.findMany({
      where: { deletedAt: null, ceasaCentralCode: { not: null } },
      distinct: ["ceasaCentralCode"],
      select: { ceasaCentralCode: true },
    });
    const codigos = emUso.map((t) => t.ceasaCentralCode!).filter(Boolean);
    if (codigos.length === 0) {
      return { centrais: 0, puladasPorTempo: 0, resultados: [] as ResultadoDaImportacao[] };
    }

    /*
      Central MANUAL fica FORA da fila.

      Não é economia de uma chamada: é o que impede a fila de travar. A ordem
      abaixo é "quem está mais atrasado primeiro", para nenhuma central passar
      fome. Só que central manual nunca recebe boletim automático — ela é
      eternamente a mais atrasada e vai eternamente para a frente. Com a pausa
      entre centrais, bastam ~20 clientes em praças manuais para o orçamento de
      tempo acabar antes de a primeira central AUTOMÁTICA ser tocada. O cliente
      que paga e tem fonte de verdade ficaria sem boletim todo dia, e nada
      apareceria como erro: o cron termina "com sucesso", só não chegou lá.
    */
    const ativas = await prisma.ceasaCentral.findMany({
      where: { code: { in: codigos }, active: true, sourceKey: { not: "manual" } },
      select: { code: true, sortOrder: true },
    });

    /*
      Ordem por QUEM ESTÁ MAIS ATRASADO, não por `sortOrder`.

      Com ordem fixa e orçamento de tempo, as últimas centrais da lista nunca
      seriam importadas — passariam fome todo dia e acabariam disparando o alarme
      de defasagem para sempre, sem que nada estivesse quebrado. Atender primeiro
      quem está sem boletim há mais tempo distribui o orçamento sozinho.
    */
    const ultimos = await prisma.ceasaQuote.groupBy({
      by: ["centralCode"],
      where: { centralCode: { in: ativas.map((c) => c.code) } },
      _max: { quoteDate: true },
    });
    const ultimoPorCentral = new Map(ultimos.map((u) => [u.centralCode, u._max.quoteDate]));
    const fila = [...ativas].sort((a, b) => {
      const da = ultimoPorCentral.get(a.code)?.getTime() ?? 0; // nunca importada vem primeiro
      const db = ultimoPorCentral.get(b.code)?.getTime() ?? 0;
      return da === db ? a.sortOrder - b.sortOrder : da - db;
    });

    const resultados: ResultadoDaImportacao[] = [];
    let puladasPorTempo = 0;

    for (const [i, c] of fila.entries()) {
      /*
        Orçamento de tempo.

        A função serverless é morta pela plataforma ao estourar o limite, no meio
        do que estiver fazendo — e aí a última central fica pela metade, sem
        registro de execução, sem alarme. Parar por conta própria antes disso é a
        diferença entre "não deu tempo hoje, amanhã pega" e "morreu calado".

        O boletim é diário: adiar uma central em algumas horas não custa nada.
      */
      if (Date.now() - inicio > orcamento) {
        puladasPorTempo = fila.length - i;
        logger.warn(
          { restantes: puladasPorTempo, decorridoMs: Date.now() - inicio },
          "Orçamento de tempo da importação esgotado — centrais restantes ficam para a próxima execução",
        );
        break;
      }
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
    return { centrais: fila.length, puladasPorTempo, resultados };
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
      where: {
        active: true,
        tenants: { some: { deletedAt: null } },
        // Central alimentada à mão não tem de quem cobrar boletim: alarmar por
        // ela seria ruído permanente sobre algo que ninguém prometeu automatizar.
        sourceKey: { not: "manual" },
      },
      select: { code: true, name: true, maxDiasSemBoletim: true },
    });
    if (centrais.length === 0) return [];

    // Um `groupBy` em vez de uma consulta por central.
    const ultimos = await prisma.ceasaQuote.groupBy({
      by: ["centralCode"],
      where: { centralCode: { in: centrais.map((c) => c.code) } },
      _max: { quoteDate: true },
    });
    const porCentral = new Map(ultimos.map((u) => [u.centralCode, u._max.quoteDate]));

    const defasadas: { code: string; name: string; dias: number | null }[] = [];
    for (const c of centrais) {
      // O limiar é o DA CENTRAL: as unidades que publicam 2 a 3 vezes por semana
      // ficariam permanentemente defasadas sob um número único.
      const f = frescorDoBoletim(porCentral.get(c.code) ?? null, agora, c.maxDiasSemBoletim);
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
      select: {
        code: true,
        name: true,
        city: true,
        uf: true,
        active: true,
        sourceKey: true,
        maxDiasSemBoletim: true,
      },
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

/** Registra a execução bem-sucedida (ou vazia) e devolve o id. */
async function registrarRun(
  centralCode: string,
  sourceKey: string,
  quoteDate: Date,
  rowsParsed: number,
  rowsUpserted: number,
  inicio: number,
  fingerprint?: string | null,
): Promise<string> {
  const run = await prisma.ceasaImportRun.create({
    data: {
      centralCode,
      sourceKey,
      quoteDate,
      // Boletim sem linha nenhuma é VAZIO, não FALHA: domingo e feriado caem
      // aqui, e chamá-los de falha ensinaria o operador a ignorar o alarme.
      status: rowsParsed > 0 ? "OK" : "VAZIO",
      rowsParsed,
      rowsUpserted,
      durationMs: Date.now() - inicio,
      fingerprint: fingerprint ?? null,
      finishedAt: new Date(),
    },
    select: { id: true },
  });
  return run.id;
}

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
