import type { AdminNotificationKind } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { describeError, logger } from "@/lib/logger";

/**
 * Caixa de entrada do super-admin.
 *
 * Existe porque a auditoria não serve para isso: ela registra TUDO, é imutável e
 * não tem estado de lido — perfeita para investigar depois, inútil para "o que
 * apareceu de novo desde que eu olhei". São propósitos diferentes e por isso
 * tabelas diferentes; o cadastro de uma empresa gera as duas coisas.
 *
 * Duas regras de desenho que valem registro:
 *
 * 1. **Notificar nunca pode quebrar quem notificou.** O cadastro público é o
 *    caminho de aquisição do produto: perder um cliente porque a linha de aviso
 *    falhou seria trocar o essencial pelo acessório. Toda escrita aqui é
 *    engolida e registrada no log.
 * 2. **A caixa é compartilhada entre os administradores**, não uma por pessoa.
 *    O aviso é sobre o negócio ("entrou um cadastro"), não sobre alguém; dois
 *    admins marcando o mesmo item como lido seria trabalho repetido. A
 *    consequência é assumida: um marca como lido e sai da tela do outro.
 */

/** Teto da listagem. A caixa é para o que é recente, não um arquivo histórico. */
const LIMITE_LISTAGEM = 100;

/**
 * Teto do contador da campainha.
 *
 * Contar 40 mil não lidas para escrever "40000" num badge é custo sem
 * informação: acima disto a tela mostra "99+", que diz o mesmo.
 */
const LIMITE_CONTAGEM = 99;

export interface AdminNotificationView {
  id: string;
  kind: AdminNotificationKind;
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

interface CriarInput {
  kind: AdminNotificationKind;
  title: string;
  body: string;
  href?: string | null;
  tenantId?: string | null;
  userId?: string | null;
}

export const AdminNotificationsService = {
  /**
   * Grava um aviso. **Não lança**: devolve `false` se não conseguiu.
   *
   * Chamado de dentro de fluxos de negócio (cadastro), onde uma exceção aqui
   * abortaria a operação que realmente importa.
   */
  async criar(input: CriarInput): Promise<boolean> {
    try {
      await prisma.adminNotification.create({
        data: {
          kind: input.kind,
          title: input.title,
          body: input.body,
          href: input.href ?? null,
          tenantId: input.tenantId ?? null,
          userId: input.userId ?? null,
        },
      });
      return true;
    } catch (e) {
      logger.error(
        { err: describeError(e), kind: input.kind },
        "Falha ao gravar notificacao do admin",
      );
      return false;
    }
  },

  /**
   * Conta nao lidas, saturando em `LIMITE_CONTAGEM`.
   *
   * Roda em TODA página do admin (a campainha fica no cabeçalho), então precisa
   * ser barata: o índice `[readAt, createdAt]` atende, e o `take` impede que a
   * contagem cresça sem limite junto com a tabela.
   */
  async contarNaoLidas(): Promise<{ total: number; saturado: boolean }> {
    try {
      const linhas = await prisma.adminNotification.findMany({
        where: { readAt: null },
        select: { id: true },
        take: LIMITE_CONTAGEM + 1,
      });
      return {
        total: Math.min(linhas.length, LIMITE_CONTAGEM),
        saturado: linhas.length > LIMITE_CONTAGEM,
      };
    } catch (e) {
      // A campainha não pode derrubar o painel inteiro.
      logger.error(
        { err: describeError(e) },
        "Falha ao contar notificacoes nao lidas",
      );
      return { total: 0, saturado: false };
    }
  },

  async listar(opts?: {
    apenasNaoLidas?: boolean;
  }): Promise<AdminNotificationView[]> {
    return prisma.adminNotification.findMany({
      where: opts?.apenasNaoLidas ? { readAt: null } : {},
      /**
       * `id` como critério de desempate, e não enfeite.
       *
       * `createdAt` é `TIMESTAMP(3)`: dois avisos gravados no mesmo milissegundo
       * têm a MESMA data — o que acontece de verdade quando dois cadastros
       * entram juntos. Com apenas `createdAt` no `ORDER BY`, o Postgres é livre
       * de devolver os empatados em qualquer ordem, e a lista embaralharia entre
       * dois carregamentos da tela sem nada ter mudado. (Foi assim que o teste
       * desta ordenação falhou no CI, que é mais rápido: os três avisos caíram
       * no mesmo milissegundo.)
       *
       * O `id` não promete ordem de criação — é cuid, não sequência. Promete
       * ordem ESTÁVEL, que é o que a tela precisa.
       */
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIMITE_LISTAGEM,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        href: true,
        readAt: true,
        createdAt: true,
      },
    });
  },

  /**
   * Marca uma como lida.
   *
   * `updateMany` com `readAt: null` no filtro em vez de `update`: id inexistente
   * não é erro (a linha pode ter sido lida em outra aba), e a data do primeiro
   * "lido" é preservada em vez de ser sobrescrita a cada clique.
   */
  async marcarComoLida(id: string): Promise<{ marcadas: number }> {
    const { count } = await prisma.adminNotification.updateMany({
      where: { id, readAt: null },
      data: { readAt: new Date() },
    });
    return { marcadas: count };
  },

  async marcarTodasComoLidas(): Promise<{ marcadas: number }> {
    const { count } = await prisma.adminNotification.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    });
    return { marcadas: count };
  },

  /**
   * Conta criada.
   *
   * Vale para os DOIS caminhos, com a origem no texto. O cadastro público é a
   * notícia de verdade (entrou alguém sozinho, e há um trial começando); o
   * cadastro pelo admin é registro — ele sabe que fez, mas a linha mantém a caixa
   * como relato completo de quem entrou, que é o que se olha no fim do dia.
   */
  async notificarUsuarioCriado(input: {
    tenantId: string;
    userId: string;
    tradeName: string;
    email: string;
    origem: "cadastro-publico" | "admin";
  }): Promise<boolean> {
    const publico = input.origem === "cadastro-publico";
    return this.criar({
      kind: "USER_CREATED",
      title: publico
        ? "Novo cadastro pelo site"
        : "Empresa cadastrada pelo painel",
      body: publico
        ? `${input.tradeName} (${input.email}) se cadastrou e vai começar o teste ao confirmar o e-mail.`
        : `${input.tradeName} (${input.email}) foi cadastrada pelo painel administrativo.`,
      href: `/admin/clientes/${input.tenantId}`,
      tenantId: input.tenantId,
      userId: input.userId,
    });
  },
};
