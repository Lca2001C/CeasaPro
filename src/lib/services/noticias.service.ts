import type { NoticiaTema } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { describeError, logger } from "@/lib/logger";
import { buscarHtml } from "@/lib/cotacoes/http";
import { FEEDS, type FeedDeNoticias } from "@/lib/noticias/fontes";
import { lerFeed } from "@/lib/noticias/parse";
import { chaveDoTitulo, classificar } from "@/lib/noticias/filtro";
import { AdminNotificationsService } from "./admin-notifications.service";

/**
 * CeasaNews: coleta e leitura das notícias.
 *
 * Tabelas GLOBAIS (`noticias`, `noticias_coletas`) com `prisma` cru — a mesma
 * notícia vale para todo cliente, e nada aqui é dado de empresa. O que é da
 * empresa (os produtos dela, para "Sobre os seus produtos") entra só na tela,
 * na hora de ler.
 *
 * Quando coleta: como sub-tarefa do cron de billing (o Hobby da Vercel aceita
 * só dois agendamentos) e, sob demanda, quando alguém abre a tela e a última
 * coleta tem mais de `IDADE_MAXIMA_MS` (ver `coletarSeVelho`). As duas podem
 * se cruzar: a gravação é idempotente por `url` e `chaveTitulo`.
 */

/** Notícia some depois disto: o módulo é o que mexe no mercado AGORA. */
const DIAS_DE_GUARDA = 30;
/** O que a tela mostra. */
const DIAS_NA_TELA = 7;
const LIMITE_NA_TELA = 80;
/** Coleta sob demanda só se a última passou disto. */
export const IDADE_MAXIMA_MS = 2 * 60 * 60 * 1000;
/** Sem nenhuma coleta boa ainda: intervalo mínimo entre tentativas na tela. */
const INTERVALO_SEM_SUCESSO_MS = 10 * 60 * 1000;
/** Item com data no futuro (fuso errado do feed) entra como "agora". */
const FOLGA_DE_FUTURO_MS = 10 * 60 * 1000;

export interface NoticiaDaTela {
  id: string;
  titulo: string;
  resumo: string;
  url: string;
  fonte: string;
  publicadaEm: Date;
  imagemUrl: string | null;
  temas: NoticiaTema[];
  pontuacao: number;
}

export interface ResultadoDaColeta {
  feeds: number;
  falhas: number;
  novas: number;
  interrompida?: boolean;
}

interface ResultadoDoFeed {
  feed: FeedDeNoticias;
  ok: boolean;
  lidos: number;
  aceitos: number;
  novos: number;
  httpStatus?: number;
  erro?: string;
  semTempo?: boolean;
  durationMs: number;
}

async function coletarFeed(feed: FeedDeNoticias, agora: Date, prazo?: number): Promise<ResultadoDoFeed> {
  const inicio = Date.now();
  const r = await buscarHtml(
    feed.url,
    { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } },
    { fonte: "noticias", feed: feed.chave },
    { prazo },
  );
  if (!r.ok) {
    return {
      feed,
      ok: false,
      lidos: 0,
      aceitos: 0,
      novos: 0,
      httpStatus: r.status,
      erro: r.erro,
      semTempo: r.semTempo,
      durationMs: Date.now() - inicio,
    };
  }
  const lido = lerFeed(r.corpo);
  if (!lido.ok) {
    return { feed, ok: false, lidos: 0, aceitos: 0, novos: 0, httpStatus: r.status, erro: lido.erro, durationMs: Date.now() - inicio };
  }

  const limiteAntigo = agora.getTime() - DIAS_DE_GUARDA * 86_400_000;
  const linhas = lido.itens
    .filter((i) => i.publicadaEm.getTime() >= limiteAntigo)
    .map((i) => ({ i, c: classificar(i.titulo, i.resumo) }))
    .filter(({ c }) => c.aceita)
    .map(({ i, c }) => ({
      url: i.url,
      chaveTitulo: chaveDoTitulo(i.titulo),
      fonte: i.fonte ?? feed.nome,
      feed: feed.chave,
      titulo: i.titulo,
      resumo: i.resumo,
      publicadaEm:
        i.publicadaEm.getTime() > agora.getTime() + FOLGA_DE_FUTURO_MS ? agora : i.publicadaEm,
      imagemUrl: i.imagemUrl,
      temas: c.temas,
      pontuacao: c.pontuacao,
    }));

  // `skipDuplicates` cobre as duas chaves únicas: a mesma URL de novo, e a
  // mesma matéria chegando pelo site E pelo Google Notícias.
  const novos =
    linhas.length > 0
      ? (await prisma.noticia.createMany({ data: linhas, skipDuplicates: true })).count
      : 0;

  return {
    feed,
    ok: true,
    lidos: lido.itens.length,
    aceitos: linhas.length,
    novos,
    httpStatus: r.status,
    durationMs: Date.now() - inicio,
  };
}

/**
 * Trava de "coleta em andamento", atômica, na tabela `rate_limits` (global, já
 * existe, e o cron limpa as vencidas). Só quem consegue gravar ou renovar a
 * linha VENCIDA coleta; a trava expira sozinha, então uma coleta que morreu
 * no meio não bloqueia a próxima.
 */
async function pegarTravaDeColeta(agora: Date): Promise<boolean> {
  const expira = new Date(agora.getTime() + 60_000);
  const linhas = await prisma.$queryRaw<{ keyHash: string }[]>`
    INSERT INTO rate_limits ("keyHash", count, "expiresAt")
    VALUES ('ceasanews:coleta', 1, ${expira})
    ON CONFLICT ("keyHash") DO UPDATE SET count = 1, "expiresAt" = EXCLUDED."expiresAt"
    WHERE rate_limits."expiresAt" < ${agora}
    RETURNING "keyHash"
  `;
  return linhas.length > 0;
}

export const NoticiasService = {
  /**
   * Busca todos os feeds em paralelo e grava o que passa no filtro.
   *
   * Um feed fora do ar não derruba os outros nem dispara alarme — as outras
   * fontes cobrem. Só TODOS falhando avisa o super-admin: aí o módulo parou.
   * Interrompido pelo prazo do cron, registra sem alarme (como as cotações).
   */
  async coletar(opts: { prazo?: number; agora?: Date } = {}): Promise<ResultadoDaColeta> {
    const agora = opts.agora ?? new Date();
    const resultados = await Promise.all(
      FEEDS.map((f) =>
        coletarFeed(f, agora, opts.prazo).catch(
          (e): ResultadoDoFeed => ({
            feed: f,
            ok: false,
            lidos: 0,
            aceitos: 0,
            novos: 0,
            erro: describeError(e),
            durationMs: 0,
          }),
        ),
      ),
    );

    await prisma.noticiaColeta.createMany({
      data: resultados.map((r) => ({
        feed: r.feed.chave,
        status: r.ok ? "OK" : "FALHA",
        lidos: r.lidos,
        aceitos: r.aceitos,
        novos: r.novos,
        httpStatus: r.httpStatus ?? null,
        erro: r.erro ? r.erro.slice(0, 500) : null,
        durationMs: r.durationMs,
      })),
    });

    await prisma.noticia.deleteMany({
      where: { publicadaEm: { lt: new Date(agora.getTime() - DIAS_DE_GUARDA * 86_400_000) } },
    });
    // O log é para ver o que parou NESTA semana; guardar um ano não ajuda ninguém.
    await prisma.noticiaColeta.deleteMany({
      where: { createdAt: { lt: new Date(agora.getTime() - DIAS_DE_GUARDA * 86_400_000) } },
    });

    const falhas = resultados.filter((r) => !r.ok);
    const interrompida = falhas.length > 0 && falhas.every((r) => r.semTempo);
    // Um aviso por vez: enquanto o anterior não for lido, repetir só enche a
    // caixa do super-admin (a tela tenta coletar a cada abertura).
    const avisoAberto =
      falhas.length === resultados.length &&
      (await prisma.adminNotification.findFirst({
        where: { kind: "NOTICIAS_FALHA", readAt: null },
        select: { id: true },
      }));
    if (falhas.length === resultados.length && !interrompida && !avisoAberto) {
      await AdminNotificationsService.criar({
        kind: "NOTICIAS_FALHA",
        title: "CeasaNews sem coleta",
        body: `Nenhum dos ${resultados.length} feeds de notícias respondeu. Primeiro erro: ${(falhas[0]?.erro ?? "desconhecido").slice(0, 200)}`,
        href: "/admin/cotacoes",
      }).catch(() => {});
    }

    const resumo = {
      feeds: resultados.length,
      falhas: falhas.length,
      novas: resultados.reduce((s, r) => s + r.novos, 0),
      ...(interrompida ? { interrompida: true } : {}),
    };
    logger.info(resumo, "Coleta do CeasaNews concluída");
    return resumo;
  },

  /** Quando foi a última coleta que trouxe algum feed com sucesso. */
  async ultimaColetaOk(): Promise<Date | null> {
    const r = await prisma.noticiaColeta.findFirst({
      where: { status: "OK" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return r?.createdAt ?? null;
  },

  /**
   * Coleta só se a última tiver mais de `IDADE_MAXIMA_MS`. É o que a tela chama
   * (em `after()`, sem segurar a resposta): entre um cron e outro passam 24 h,
   * e notícia de geada de manhã não pode chegar só no dia seguinte.
   */
  async coletarSeVelho(agora = new Date()): Promise<ResultadoDaColeta | null> {
    const ultima = await prisma.noticiaColeta.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (ultima && agora.getTime() - ultima.createdAt.getTime() < IDADE_MAXIMA_MS) return null;
    // O registro da coleta só é gravado no FIM (até 25 s depois): sem trava,
    // toda abertura da tela nesse intervalo disparava outra coleta inteira.
    if (!(await pegarTravaDeColeta(agora))) return null;
    return this.coletar({ agora, prazo: agora.getTime() + 25_000 });
  },

  /**
   * Primeira vez do módulo: nenhuma coleta jamais deu certo. Coleta já, com
   * prazo curto, e diz se coletou. Falha aqui é registrada e não derruba a tela.
   */
  async primeiraColetaSeNunca(agora = new Date()): Promise<boolean> {
    if (await this.ultimaColetaOk()) return false;
    // Sem coleta boa, mas tentada há pouco (os feeds estão fora, ou a rede do
    // servidor não sai): não tenta de novo a cada abertura da tela — cada
    // tentativa segurava a página por até 20 s. E a trava de sempre, para dois
    // acessos ao mesmo tempo não dispararem duas coletas.
    const tentativa = await prisma.noticiaColeta.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (tentativa && agora.getTime() - tentativa.createdAt.getTime() < INTERVALO_SEM_SUCESSO_MS) {
      return false;
    }
    if (!(await pegarTravaDeColeta(agora))) return false;
    await this.coletar({ agora, prazo: agora.getTime() + 20_000 }).catch((e) =>
      logger.error({ err: describeError(e) }, "Primeira coleta do CeasaNews falhou"),
    );
    return true;
  },

  async listar(opts: { tema?: NoticiaTema; agora?: Date } = {}): Promise<NoticiaDaTela[]> {
    const agora = opts.agora ?? new Date();
    return prisma.noticia.findMany({
      where: {
        publicadaEm: { gte: new Date(agora.getTime() - DIAS_NA_TELA * 86_400_000) },
        ...(opts.tema ? { temas: { has: opts.tema } } : {}),
      },
      orderBy: [{ publicadaEm: "desc" }, { pontuacao: "desc" }],
      take: LIMITE_NA_TELA,
      select: {
        id: true,
        titulo: true,
        resumo: true,
        url: true,
        fonte: true,
        publicadaEm: true,
        imagemUrl: true,
        temas: true,
        pontuacao: true,
      },
    });
  },

  /** Para o super-admin: a última coleta de cada feed. */
  async situacaoDosFeeds() {
    const ultimas = await prisma.noticiaColeta.findMany({
      where: { feed: { in: FEEDS.map((f) => f.chave) } },
      orderBy: { createdAt: "desc" },
      distinct: ["feed"],
    });
    const porFeed = new Map(ultimas.map((u) => [u.feed, u]));
    const total = await prisma.noticia.count();
    return {
      total,
      feeds: FEEDS.map((f) => ({ chave: f.chave, nome: f.nome, url: f.url, ultima: porFeed.get(f.chave) ?? null })),
    };
  },
};
