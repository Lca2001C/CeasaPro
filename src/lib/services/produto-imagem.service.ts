import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AppError, ValidationError } from "@/lib/http/app-error";
import { rateLimitDb } from "@/lib/security/rate-limit-db";
import {
  IMAGEM_MAX_BYTES,
  PREFIXO_CATALOGO,
  detectarFormato,
  prefixoDaEmpresa,
} from "@/lib/imagem/formato";
import { deleteObject, listarObjetos, publicUrl, putObject } from "@/lib/storage/r2";

/**
 * Foto de produto: gravação no R2 e a conferência de QUEM pode usar cada chave.
 *
 * A chave chega do navegador no `imageKey` do produto, então é dado de cliente
 * como qualquer outro. Sem a conferência, uma empresa gravaria no próprio
 * produto a chave da foto de outra — e a tela de quem fez isso exibiria a foto
 * alheia (o bucket é público; o que protege é o cadastro só aceitar chaves da
 * própria empresa ou do banco da plataforma).
 */

const CHAVE_DA_EMPRESA = /^tenants\/[^/]+\/produtos\/[0-9a-f-]{36}\.(webp|jpg|png)$/;

/**
 * Teto de fotos enviadas por empresa por dia. Cada envio grava um objeto no
 * bucket ANTES de o produto ser salvo; sem teto, um script com uma sessão
 * válida enchia o bucket (e a conta do R2) sem cadastrar produto nenhum.
 * 100/dia cobre com folga quem está cadastrando o estoque inteiro de uma vez.
 */
const FOTOS_POR_DIA = 100;

/** Foto sem produto há mais que isto vira lixo (o formulário foi abandonado). */
const IDADE_PARA_ORFA_MS = 24 * 3600_000;

function decodificar(base64: string): Uint8Array {
  const limpo = base64.replace(/^data:[^,]*,/, "");
  const bytes = Buffer.from(limpo, "base64");
  if (bytes.length === 0) throw new ValidationError("Foto inválida");
  if (bytes.length > IMAGEM_MAX_BYTES) {
    throw new ValidationError("Foto grande demais. Tente outra foto.");
  }
  return new Uint8Array(bytes);
}

async function gravar(prefixo: string, base64: string) {
  const bytes = decodificar(base64);
  const formato = detectarFormato(bytes);
  if (!formato) throw new ValidationError("Envie uma foto (JPG, PNG ou WebP).");
  const imageKey = `${prefixo}${randomUUID()}.${formato.ext}`;
  await putObject(imageKey, bytes, formato.contentType);
  return { imageKey, url: publicUrl(imageKey) };
}

export const ProdutoImagemService = {
  /** Foto tirada/escolhida pela empresa. */
  async enviarDaEmpresa(tenantId: string, base64: string) {
    const rl = await rateLimitDb(`foto-produto:${tenantId}`, {
      limit: FOTOS_POR_DIA,
      windowMs: 24 * 3600_000,
    });
    if (!rl.ok) {
      throw new AppError(
        "RATE_LIMIT",
        "Muitas fotos enviadas hoje. Salve os produtos sem foto e tente amanhã.",
        429,
      );
    }
    return gravar(prefixoDaEmpresa(tenantId), base64);
  },

  /** Foto do banco da plataforma (super-admin). */
  enviarDoCatalogo(base64: string) {
    return gravar(PREFIXO_CATALOGO, base64);
  },

  /**
   * A empresa pode gravar esta chave no produto?
   *
   * Aceita: foto da própria empresa, foto ATIVA do banco da plataforma, ou a
   * chave que o produto já tinha (`atual`) — uma foto do banco desativada
   * depois continua valendo para quem já a usava, e salvar o produto sem mexer
   * na foto não pode virar erro.
   */
  async validarChave(
    tenantId: string,
    imageKey: string | null | undefined,
    atual?: string | null,
  ): Promise<string | null> {
    if (!imageKey) return null;
    if (atual && imageKey === atual) return imageKey;
    if (imageKey.startsWith(prefixoDaEmpresa(tenantId)) && CHAVE_DA_EMPRESA.test(imageKey)) {
      return imageKey;
    }
    if (imageKey.startsWith(PREFIXO_CATALOGO)) {
      const doCatalogo = await prisma.catalogoImagem.findFirst({
        where: { imageKey, ativo: true },
        select: { id: true },
      });
      if (doCatalogo) return imageKey;
    }
    throw new ValidationError("Foto inválida. Escolha a foto de novo.", {
      imageKey: "Foto inválida",
    });
  },

  /**
   * Apaga do bucket as fotos de empresa que nenhum produto usa: a enviada num
   * formulário abandonado, a trocada antes de salvar. Só as com mais de 24 h —
   * a mais nova pode estar num formulário aberto agora. Produto excluído
   * (soft delete) continua segurando a dele.
   *
   * Roda no cron, com prazo: o que não couber hoje fica para amanhã.
   */
  async limparOrfas(opts: { prazo: number; agora?: Date }) {
    const agora = opts.agora ?? new Date();
    let proxima: string | undefined;
    let vistas = 0;
    let apagadas = 0;
    do {
      if (Date.now() > opts.prazo) break;
      const pagina = await listarObjetos("tenants/", proxima);
      if (!pagina) return { pulado: "R2 nao configurado" };
      vistas += pagina.objetos.length;
      const candidatas = pagina.objetos
        .filter((o) => CHAVE_DA_EMPRESA.test(o.key))
        .filter((o) => agora.getTime() - o.lastModified.getTime() > IDADE_PARA_ORFA_MS)
        .map((o) => o.key);
      if (candidatas.length > 0) {
        // `prisma` cru de propósito: a busca é entre empresas (a chave já diz
        // de quem é) e precisa ver também o produto excluído.
        const usadas = await prisma.$queryRaw<{ imageKey: string }[]>`
          SELECT "imageKey" FROM products WHERE "imageKey" IN (${Prisma.join(candidatas)})`;
        const emUso = new Set(usadas.map((u) => u.imageKey));
        for (const key of candidatas) {
          if (emUso.has(key)) continue;
          if (Date.now() > opts.prazo) break;
          await deleteObject(key);
          apagadas++;
        }
      }
      proxima = pagina.proxima ?? undefined;
    } while (proxima);
    return { vistas, apagadas };
  },

  /** Apaga do bucket a foto antiga DA EMPRESA (nunca a do banco da plataforma). */
  async descartarDaEmpresa(tenantId: string, imageKey: string | null | undefined) {
    if (!imageKey || !imageKey.startsWith(prefixoDaEmpresa(tenantId))) return;
    await deleteObject(imageKey);
  },
};
