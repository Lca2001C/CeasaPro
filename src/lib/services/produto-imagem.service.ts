import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ValidationError } from "@/lib/http/app-error";
import {
  IMAGEM_MAX_BYTES,
  PREFIXO_CATALOGO,
  detectarFormato,
  prefixoDaEmpresa,
} from "@/lib/imagem/formato";
import { deleteObject, publicUrl, putObject } from "@/lib/storage/r2";

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
  enviarDaEmpresa(tenantId: string, base64: string) {
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

  /** Apaga do bucket a foto antiga DA EMPRESA (nunca a do banco da plataforma). */
  async descartarDaEmpresa(tenantId: string, imageKey: string | null | undefined) {
    if (!imageKey || !imageKey.startsWith(prefixoDaEmpresa(tenantId))) return;
    await deleteObject(imageKey);
  },
};
