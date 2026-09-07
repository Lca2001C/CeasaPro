import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { slugProduto } from "@/lib/cotacoes/nome";
import { NotFoundError } from "@/lib/http/app-error";
import type { LinhaDeCotacao } from "@/lib/cotacoes/csv";

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
