import "server-only";
import { AwsClient } from "aws4fetch";
import { XMLParser } from "fast-xml-parser";
import { AppError } from "@/lib/http/app-error";
import { logger } from "@/lib/logger";

/**
 * Cloudflare R2 (API compatível com S3) para as fotos de produto.
 *
 * `aws4fetch` só assina a requisição (SigV4) e usa o `fetch` do runtime — sem
 * o SDK da AWS, que é pesado para uma função serverless que só faz PUT e
 * DELETE.
 *
 * O upload passa SEMPRE pelo servidor (o navegador manda a foto já comprimida
 * para a Server Action, e a action grava aqui). Por isso a CSP não precisa
 * liberar o host do R2 em `connect-src`; a exibição usa `img-src https:`, que
 * já está liberado, direto do domínio público do bucket (`R2_PUBLIC_URL`).
 *
 * Sem as cinco variáveis, `r2Configurado()` é falso: a tela desabilita os
 * botões de foto e o cadastro de produto segue funcionando.
 */

function config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

export function r2Configurado(): boolean {
  return config() !== null;
}

function exigirConfig() {
  const c = config();
  if (!c) {
    throw new AppError(
      "STORAGE_INDISPONIVEL",
      "O envio de fotos não está disponível agora. Salve o produto sem foto e tente mais tarde.",
      503,
    );
  }
  return c;
}

function urlDoObjeto(c: NonNullable<ReturnType<typeof config>>, key: string) {
  const caminho = key.split("/").map(encodeURIComponent).join("/");
  return `https://${c.accountId}.r2.cloudflarestorage.com/${c.bucket}/${caminho}`;
}

function cliente(c: NonNullable<ReturnType<typeof config>>) {
  return new AwsClient({
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  const c = exigirConfig();
  const res = await cliente(c).fetch(urlDoObjeto(c, key), {
    method: "PUT",
    body: body as unknown as BodyInit,
    headers: {
      "Content-Type": contentType,
      // A chave é um UUID novo a cada envio: o objeto nunca muda depois de
      // gravado, então o cache pode ser eterno.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  if (!res.ok) {
    // O código do R2 (SignatureDoesNotMatch, AccessDenied, NoSuchBucket…) diz
    // se é credencial, permissão ou bucket — sem ele, o erro era invisível.
    const corpo = await res.text().catch(() => "");
    logger.error(
      { status: res.status, codigo: corpo.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? null },
      "R2: falha ao gravar foto",
    );
    throw new AppError("STORAGE_FALHA", "Não foi possível enviar a foto. Tente de novo.", 502);
  }
}

/** Best-effort: foto órfã no bucket custa centavos; derrubar a gravação por ela, não. */
export async function deleteObject(key: string): Promise<void> {
  const c = config();
  if (!c) return;
  try {
    await cliente(c).fetch(urlDoObjeto(c, key), { method: "DELETE" });
  } catch {
    // ignora — ver doc acima
  }
}

export interface ObjetoListado {
  key: string;
  lastModified: Date;
}

/**
 * Uma página de `ListObjectsV2` sob `prefixo`. Devolve `null` sem R2
 * configurado. `continuacao` vem da página anterior (`proxima`).
 */
export async function listarObjetos(
  prefixo: string,
  continuacao?: string,
): Promise<{ objetos: ObjetoListado[]; proxima: string | null } | null> {
  const c = config();
  if (!c) return null;
  const url = new URL(`https://${c.accountId}.r2.cloudflarestorage.com/${c.bucket}`);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", prefixo);
  url.searchParams.set("max-keys", "1000");
  if (continuacao) url.searchParams.set("continuation-token", continuacao);
  const res = await cliente(c).fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`R2 ListObjectsV2 respondeu ${res.status}`);
  const xml = new XMLParser({ isArray: (nome) => nome === "Contents" }).parse(await res.text());
  const r = xml?.ListBucketResult ?? {};
  const objetos: ObjetoListado[] = (r.Contents ?? []).map(
    (o: { Key: unknown; LastModified: unknown }) => ({
      key: String(o.Key),
      lastModified: new Date(String(o.LastModified)),
    }),
  );
  const truncada = String(r.IsTruncated) === "true";
  return { objetos, proxima: truncada && r.NextContinuationToken ? String(r.NextContinuationToken) : null };
}

/** URL pública de exibição. `null` sem chave ou sem R2 configurado. */
export function publicUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const c = config();
  if (!c) return null;
  const caminho = key.split("/").map(encodeURIComponent).join("/");
  return `${c.publicUrl}/${caminho}`;
}
