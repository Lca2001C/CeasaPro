import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { lerCsvDeCotacoes } from "@/lib/cotacoes/csv";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { rateLimitDb } from "@/lib/security/rate-limit-db";
import { isoDateTz } from "@/lib/tz";
import { AdminNotificationsService } from "./admin-notifications.service";
import { CotacoesImportService } from "./cotacoes-import.service";
import type { AdminCtx, TenantCtx } from "@/lib/http/with-action";

/**
 * O boletim que o CLIENTE envia, e a fila que o super-admin publica.
 *
 * Por que existe uma fila, e não gravação direta
 *
 * Das 66 praças do catálogo, 57 não têm raspador — o boletim delas só aparece se
 * alguém colar. Isso põe o super-admin no caminho crítico de um recurso pago, e
 * quem fica sem preço é justamente quem contratou. A saída óbvia seria deixar o
 * cliente gravar em `ceasa_quotes`, e ela não se sustenta:
 *
 *  - `CotacoesImportService.gravar` termina em `ON CONFLICT DO UPDATE`: é
 *    primitiva de SOBRESCRITA, e um envio na data que o operador já colou
 *    apagaria o dado do operador;
 *  - `gravar` também escreve em `ceasa_products`, catálogo GLOBAL — nomes
 *    inventados apareceriam na tela de vínculo de todos os clientes da praça;
 *  - `ceasa_quotes` é global: o preço enviado é o que os concorrentes leem;
 *  - nenhum dos três alarmes vigia praça manual (`verificarDefasagem` exclui
 *    `sourceKey = 'manual'`, `conferirFingerprint` só roda pelo importador).
 *
 * E como toda leitura parte de `MAX(quoteDate)`, um dado ruim em praça manual é
 * permanente por definição. Então o envio vira RASCUNHO com `tenantId` — visível
 * só para quem enviou — e publicar continua sendo ato do operador, pelo mesmo
 * `gravar`, do lado de dentro da fronteira de confiança que já existia.
 *
 * O valor original se mantém: o cliente não depende de ninguém transcrever o
 * boletim dele. O que sai é o tenant escrevendo em tabela compartilhada.
 */

/** Quantos envios por dia, por empresa. */
const ENVIOS_POR_DIA = 5;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

export const CotacoesEnvioService = {
  /**
   * A tela do cliente: a praça dele, se ela aceita envio, e o que ele já mandou.
   *
   * `podeEnviar` é falso em praça com raspador, e isso é produto, não permissão:
   * onde a busca automática funciona, um envio manual competiria com ela pela
   * mesma data — e o `ON CONFLICT DO UPDATE` faria o último a chegar vencer, sem
   * ninguém entender por que o preço mudou sozinho.
   */
  async getTela(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        ceasaCentral: { select: { code: true, name: true, city: true, uf: true, sourceKey: true } },
      },
    });
    const central = tenant?.ceasaCentral ?? null;

    const enviados = await prisma.tenantBoletimEnviado.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        quoteDate: true,
        status: true,
        linhasValidas: true,
        linhasIgnoradas: true,
        motivo: true,
        createdAt: true,
      },
    });

    return {
      central: central
        ? { code: central.code, name: central.name, city: central.city, uf: central.uf }
        : null,
      podeEnviar: central !== null && central.sourceKey === "manual",
      enviados,
    };
  },

  /**
   * O cliente envia. Nada é publicado aqui.
   *
   * Confere o CSV na hora para o cliente ver o resultado do parse antes de
   * esperar por um humano: mandar para a fila um texto que não rende linha
   * nenhuma seria fazer duas pessoas descobrirem o mesmo erro em momentos
   * diferentes.
   */
  async enviar(
    input: { quoteDate: Date; texto: string },
    ctx: TenantCtx,
  ) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { ceasaCentral: { select: { code: true, sourceKey: true } } },
    });
    const central = tenant?.ceasaCentral;
    if (!central) {
      throw new BusinessRuleError("Escolha a sua central do CEASA antes de enviar boletim.");
    }
    if (central.sourceKey !== "manual") {
      /*
        Praça com raspador não aceita envio.

        Não é desconfiança do cliente: é que os dois caminhos gravariam a mesma
        data, `gravar` sobrescreve, e o preço passaria a mudar conforme quem
        chegou por último — um comportamento que ninguém consegue explicar
        olhando a tela.
      */
      throw new BusinessRuleError(
        "A sua central já tem busca automática de boletim — não é preciso enviar.",
      );
    }

    /*
      Rate limit no Postgres, e não em memória.

      O envio guarda o texto colado (até 500 mil caracteres) e cria notificação
      para o operador. Sem teto, um laço acidental na tela do cliente enche a
      tabela e a caixa de avisos do super-admin. O limitador em memória não serve
      aqui porque cada instância serverless teria o seu próprio contador.
    */
    const limite = await rateLimitDb(`cotacoes:envio:${ctx.tenantId}`, {
      limit: ENVIOS_POR_DIA,
      windowMs: UM_DIA_MS,
    });
    if (!limite.ok) {
      throw new BusinessRuleError(
        "Você já enviou boletim várias vezes hoje. Tente de novo amanhã.",
      );
    }

    const { linhas, erros } = lerCsvDeCotacoes(input.texto);
    if (linhas.length === 0) {
      throw new BusinessRuleError(
        erros.length > 0
          ? `Nenhuma linha válida. Primeiro problema: linha ${erros[0]!.linha} — ${erros[0]!.motivo}.`
          : "Nenhuma linha encontrada no texto colado.",
      );
    }

    const enviado = await prisma.$transaction(async (tx) => {
      const criado = await tx.tenantBoletimEnviado.create({
        data: {
          tenantId: ctx.tenantId,
          centralCode: central.code,
          quoteDate: input.quoteDate,
          textoCru: input.texto,
          linhasValidas: linhas.length,
          linhasIgnoradas: erros.length,
        },
        select: { id: true },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "TenantBoletimEnviado",
          entityId: criado.id,
          newData: {
            central: central.code,
            data: isoDateTz(input.quoteDate),
            linhas: linhas.length,
          },
          ip: ctx.ip,
        },
        tx,
      );
      return criado;
    });

    // Fora da transação e sem derrubar o envio: a caixa do super-admin é
    // conveniência, e o rascunho do cliente já está salvo.
    await AdminNotificationsService.criar({
      kind: "COTACOES_ENVIO_CLIENTE",
      title: "Boletim enviado por cliente",
      body: `${ctx.session.email} enviou o boletim de ${central.code} (${linhas.length} linhas) para publicação.`,
      href: "/admin/cotacoes",
      tenantId: ctx.tenantId,
    }).catch((e) => {
      logger.error({ err: e instanceof Error ? e.message : String(e) }, "Aviso de envio falhou");
    });

    return { id: enviado.id, linhasValidas: linhas.length, ignoradas: erros.length };
  },

  /** A fila do operador: pendentes primeiro, mais antigo antes. */
  async listarFila() {
    return prisma.tenantBoletimEnviado.findMany({
      where: { status: "PENDENTE" },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        quoteDate: true,
        linhasValidas: true,
        linhasIgnoradas: true,
        textoCru: true,
        createdAt: true,
        central: { select: { code: true, name: true, uf: true } },
        tenant: { select: { id: true, tradeName: true } },
      },
    });
  },

  /**
   * O operador publica: aqui, sim, o dado entra na tabela global.
   *
   * Reparseia o `textoCru` em vez de confiar no `linhasValidas` gravado no
   * envio: entre o envio e a publicação o parser pode ter mudado, e publicar um
   * número que ninguém recontou seria publicar o que o código de ontem entendeu.
   */
  async publicar(input: { id: string }, ctx: AdminCtx) {
    const envio = await prisma.tenantBoletimEnviado.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        tenantId: true,
        centralCode: true,
        quoteDate: true,
        textoCru: true,
        status: true,
      },
    });
    if (!envio) throw new NotFoundError("Envio não encontrado.");
    if (envio.status !== "PENDENTE") {
      throw new BusinessRuleError("Este envio já foi revisado.");
    }

    const { linhas, erros } = lerCsvDeCotacoes(envio.textoCru);
    if (linhas.length === 0) {
      throw new BusinessRuleError("O texto enviado não tem nenhuma linha válida.");
    }

    /*
      `sourceKey: "cliente"`, e não `"manual"`.

      A procedência tem de sobreviver na `CeasaImportRun`: quando o preço de uma
      praça for contestado, a diferença entre "o operador colou" e "um cliente
      enviou e o operador publicou" é a primeira coisa que alguém vai querer
      saber. `fontePara("cliente")` devolve `null`, então esta chave nunca é
      confundida com uma fonte automática, e `serieDaFonte` a trata como CENTRAL
      — que é o que ela é.
    */
    const r = await CotacoesImportService.gravar({
      centralCode: envio.centralCode,
      quoteDate: envio.quoteDate,
      linhas,
      sourceKey: "cliente",
    });

    await prisma.$transaction(async (tx) => {
      await tx.tenantBoletimEnviado.update({
        where: { id: envio.id },
        data: { status: "PUBLICADO", revisadoPor: ctx.session.email, revisadoEm: new Date() },
      });
      /*
        A auditoria vai no tenant do CLIENTE, não num escopo do admin.

        É o dono do box que vai perguntar "quem publicou o meu boletim?", e
        `/atividades` é onde ele procura. Um registro que só o super-admin vê
        responderia à pessoa errada.
      */
      await audit(
        {
          tenantId: envio.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "TenantBoletimEnviado",
          entityId: envio.id,
          newData: { status: "PUBLICADO", cotacoesGravadas: r.cotacoesGravadas },
          ip: ctx.ip,
        },
        tx,
      );
    });

    return { cotacoesGravadas: r.cotacoesGravadas, produtosNovos: r.produtosNovos, ignoradas: erros.length };
  },

  /** O operador recusa, com motivo — senão o cliente reenvia o mesmo erro. */
  async recusar(input: { id: string; motivo: string }, ctx: AdminCtx) {
    const envio = await prisma.tenantBoletimEnviado.findUnique({
      where: { id: input.id },
      select: { id: true, tenantId: true, status: true },
    });
    if (!envio) throw new NotFoundError("Envio não encontrado.");
    if (envio.status !== "PENDENTE") {
      throw new BusinessRuleError("Este envio já foi revisado.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.tenantBoletimEnviado.update({
        where: { id: envio.id },
        data: {
          status: "RECUSADO",
          motivo: input.motivo,
          revisadoPor: ctx.session.email,
          revisadoEm: new Date(),
        },
      });
      await audit(
        {
          tenantId: envio.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "TenantBoletimEnviado",
          entityId: envio.id,
          newData: { status: "RECUSADO", motivo: input.motivo },
          ip: ctx.ip,
        },
        tx,
      );
    });
  },
};
