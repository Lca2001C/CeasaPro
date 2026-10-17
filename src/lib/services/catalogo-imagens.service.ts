import "server-only";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { normalizarNome, primeiraPalavra } from "@/lib/cotacoes/nome";
import { deleteObject, publicUrl } from "@/lib/storage/r2";
import { ProdutoImagemService } from "./produto-imagem.service";
import type { AdminCtx } from "@/lib/http/with-action";

/**
 * Banco de fotos da plataforma ("Banco" no cadastro de produto).
 *
 * Tabela GLOBAL (`catalogo_imagens`, sem `tenantId`) lida com `prisma` cru, no
 * molde das tabelas do boletim: a foto do tomate é a mesma para todo cliente.
 * Só o super-admin grava; a empresa só busca.
 */

export interface FotoDoCatalogo {
  id: string;
  nome: string;
  imageKey: string;
  url: string | null;
  ativo: boolean;
}

function paraTela(r: {
  id: string;
  nome: string;
  imageKey: string;
  ativo: boolean;
}): FotoDoCatalogo {
  return { ...r, url: publicUrl(r.imageKey) };
}

/** Todas as palavras da busca precisam aparecer ("tomate ita" acha "Tomate italiano"). */
function filtroDeBusca(q: string | undefined) {
  const termos = normalizarNome(q ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 5);
  return termos.length ? { AND: termos.map((t) => ({ slug: { contains: t } })) } : {};
}

export const CatalogoImagensService = {
  /** O que a empresa vê no "Banco": só as ativas. */
  async buscar(q?: string): Promise<FotoDoCatalogo[]> {
    const rows = await prisma.catalogoImagem.findMany({
      where: { ativo: true, ...filtroDeBusca(q) },
      orderBy: { nome: "asc" },
      take: 60,
    });
    return rows.map(paraTela);
  },

  /**
   * Uma foto por família de produto ("tomate", "batata"), para ILUSTRAR o que
   * não tem foto própria — hoje, as notícias do CeasaNews que chegam pelo Google
   * Notícias, que não manda imagem. Em ordem de nome, então "Batata" vence
   * "Batata-doce" na família "batata". Sem R2 configurado, lista vazia.
   */
  async paraIlustrar(): Promise<{ chave: string; url: string }[]> {
    const rows = await prisma.catalogoImagem.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { nome: true, imageKey: true },
    });
    const porChave = new Map<string, string>();
    for (const r of rows) {
      const chave = primeiraPalavra(r.nome);
      const url = publicUrl(r.imageKey);
      if (chave && url && !porChave.has(chave)) porChave.set(chave, url);
    }
    return [...porChave].map(([chave, url]) => ({ chave, url }));
  },

  async listarAdmin(q?: string): Promise<(FotoDoCatalogo & { emUso: number })[]> {
    const rows = await prisma.catalogoImagem.findMany({
      where: filtroDeBusca(q),
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
      take: 300,
    });
    const uso = rows.length
      ? await prisma.product.groupBy({
          by: ["imageKey"],
          where: { imageKey: { in: rows.map((r) => r.imageKey) }, deletedAt: null },
          _count: { _all: true },
        })
      : [];
    const contagem = new Map(uso.map((u) => [u.imageKey, u._count._all]));
    return rows.map((r) => ({ ...paraTela(r), emUso: contagem.get(r.imageKey) ?? 0 }));
  },

  async criar(input: { nome: string; base64: string }, ctx: AdminCtx) {
    const { imageKey } = await ProdutoImagemService.enviarDoCatalogo(input.base64);
    const foto = await prisma.catalogoImagem.create({
      data: { nome: input.nome, slug: normalizarNome(input.nome), imageKey },
    });
    await audit({
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "CatalogoImagem",
      entityId: foto.id,
      newData: { nome: foto.nome, imageKey },
      ip: ctx.ip,
    });
    return paraTela(foto);
  },

  async atualizar(input: { id: string; nome: string; ativo: boolean }, ctx: AdminCtx) {
    const antes = await prisma.catalogoImagem.findUnique({ where: { id: input.id } });
    if (!antes) throw new NotFoundError("Foto não encontrada");
    const foto = await prisma.catalogoImagem.update({
      where: { id: input.id },
      data: { nome: input.nome, slug: normalizarNome(input.nome), ativo: input.ativo },
    });
    await audit({
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "CatalogoImagem",
      entityId: foto.id,
      oldData: { nome: antes.nome, ativo: antes.ativo },
      newData: { nome: foto.nome, ativo: foto.ativo },
      ip: ctx.ip,
    });
    return paraTela(foto);
  },

  /**
   * Exclui de vez — só sem nenhum produto usando. O produto guarda a MESMA
   * chave; apagar o objeto deixaria a foto quebrada na tela do cliente. Em uso,
   * o caminho é desativar (some do Banco, continua nos produtos).
   */
  async excluir(id: string, ctx: AdminCtx) {
    const foto = await prisma.catalogoImagem.findUnique({ where: { id } });
    if (!foto) throw new NotFoundError("Foto não encontrada");
    const emUso = await prisma.product.count({
      where: { imageKey: foto.imageKey, deletedAt: null },
    });
    if (emUso > 0) {
      throw new BusinessRuleError(
        `Esta foto está em ${emUso} produto(s) de clientes. Desative-a para tirar do Banco.`,
      );
    }
    await prisma.catalogoImagem.delete({ where: { id } });
    await deleteObject(foto.imageKey);
    await audit({
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "CatalogoImagem",
      entityId: id,
      oldData: { nome: foto.nome, imageKey: foto.imageKey },
      ip: ctx.ip,
    });
  },
};
