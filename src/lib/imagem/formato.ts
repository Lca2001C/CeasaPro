/**
 * Foto de produto: o que o servidor aceita guardar.
 *
 * Puro e sem imports — roda no servidor (validação do upload) e no navegador
 * (o seletor usa os mesmos limites antes de enviar).
 *
 * O tipo é decidido pelos PRIMEIROS BYTES do arquivo, nunca pelo MIME que o
 * navegador declarou nem pela extensão: os dois são texto escolhido por quem
 * envia, e o bucket é público — um "image/png" que na verdade é HTML viraria
 * página servida do nosso domínio de fotos.
 */

/** Teto do arquivo já comprimido. A foto sai do celular com ~100 KB. */
export const IMAGEM_MAX_BYTES = 1024 * 1024;

/** Lado maior da foto depois da compressão no aparelho. */
export const IMAGEM_LADO_MAX = 1024;

export type FormatoImagem = { ext: "webp" | "jpg" | "png"; contentType: string };

export function detectarFormato(bytes: Uint8Array): FormatoImagem | null {
  const b = bytes;
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return { ext: "png", contentType: "image/png" };
  }
  // WebP: "RIFF" ???? "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

/**
 * O que o APARELHO entregou, pelos bytes — antes de comprimir.
 *
 * O banco não guarda este arquivo. A tela converte tudo (inclusive HEIC do
 * iPhone e AVIF) para um WebP/JPEG pequeno, e o Postgres fica só com a chave.
 * `detectarFormato` continua sendo o que o servidor aceita gravar no bucket.
 */
export function classificarFoto(bytes: Uint8Array, declarado = ""): string {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";

  const marcas = marcasFtyp(b);
  if (marcas.some((m) => m === "avif" || m === "avis")) return "image/avif";
  if (marcas.some((m) => HEIC.has(m))) return "image/heic";

  const mime = declarado.toLowerCase();
  if (mime === "image/heic" || mime === "image/heif") return "image/heic";
  if (mime.startsWith("image/")) return mime;
  return "image/jpeg";
}

/** Marcas HEIC/HEIF no `ftyp`. `mif1` sozinho também é HEIF. */
const HEIC = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "heif",
  "mif1",
  "msf1",
]);

function marcasFtyp(b: Uint8Array): string[] {
  if (b.length < 12 || b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) {
    return [];
  }
  const marcas: string[] = [];
  const fim = Math.min(b.length, 64);
  for (let i = 8; i + 4 <= fim; i += 4) {
    if (i === 12) continue;
    marcas.push(String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]).toLowerCase());
  }
  return marcas;
}

/** Prefixo das fotos de uma empresa no bucket. */
export function prefixoDaEmpresa(tenantId: string): string {
  return `tenants/${tenantId}/produtos/`;
}

/** Prefixo das fotos do banco da plataforma. */
export const PREFIXO_CATALOGO = "catalogo/";
