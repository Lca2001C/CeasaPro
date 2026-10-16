import { IMAGEM_LADO_MAX, IMAGEM_MAX_BYTES } from "./formato";

/**
 * Reduz a foto NO APARELHO antes de enviar.
 *
 * Foto de celular sai com 3–8 MB; a Server Action aceita 1 MB e o plano da
 * Vercel corta o corpo em 4,5 MB. Mais que isso: no 4G do galpão, subir 6 MB
 * para mostrar uma miniatura de 64 px é tempo de balcão jogado fora. Aqui a foto
 * vira um WebP (ou JPEG, onde o navegador não codifica WebP) com o lado maior em
 * {@link IMAGEM_LADO_MAX} px — tipicamente ~100 KB.
 *
 * `createImageBitmap` com `imageOrientation: "from-image"` respeita a rotação
 * EXIF: sem isso, a foto tirada com o celular em pé chegava deitada.
 *
 * Só roda no navegador.
 */
export async function comprimirFoto(arquivo: File): Promise<{ base64: string; previa: string }> {
  if (!arquivo.type.startsWith("image/")) {
    throw new Error("Escolha uma foto.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    // HEIC no navegador que não o decodifica, arquivo corrompido…
    throw new Error("Não foi possível abrir esta foto. Tente outra.");
  }

  const escala = Math.min(1, IMAGEM_LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a foto.");
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();

  const blob = await gerarBlob(canvas);
  if (blob.size > IMAGEM_MAX_BYTES) {
    throw new Error("Foto grande demais. Tente outra.");
  }

  const dataUrl = await lerComoDataUrl(blob);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), previa: dataUrl };
}

async function gerarBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const paraBlob = (tipo: string, qualidade: number) =>
    new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, qualidade));

  // Safari antigo devolve PNG quando não sabe codificar WebP — PNG de foto é
  // enorme, então confere o tipo devolvido e cai para JPEG.
  const webp = await paraBlob("image/webp", 0.8);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await paraBlob("image/jpeg", 0.82);
  if (jpeg) return jpeg;
  throw new Error("Não foi possível preparar a foto.");
}

function lerComoDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result));
    leitor.onerror = () => falha(new Error("Não foi possível ler a foto."));
    leitor.readAsDataURL(blob);
  });
}
