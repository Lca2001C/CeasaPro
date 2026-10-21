import { IMAGEM_LADO_MAX, IMAGEM_MAX_BYTES } from "./formato";

/**
 * Reduz a foto NO APARELHO antes de enviar.
 *
 * Foto de celular sai com 3–8 MB; a Server Action aceita 2 MB e o plano da
 * Vercel corta o corpo em 4,5 MB. Mais que isso: no 4G do galpão, subir 6 MB
 * para mostrar uma miniatura de 64 px é tempo de balcão jogado fora. Aqui a foto
 * vira um WebP (ou JPEG, onde o navegador não codifica WebP) com o lado maior em
 * {@link IMAGEM_LADO_MAX} px — tipicamente ~100 KB.
 *
 * Só roda no navegador.
 */
export async function comprimirFoto(arquivo: File): Promise<{ base64: string; previa: string }> {
  // A câmera de alguns Android entrega o arquivo com `type` vazio: só recusa o
  // que se declara outra coisa. Quem decide de verdade é a decodificação.
  if (arquivo.type && !arquivo.type.startsWith("image/")) {
    throw new Error("Escolha uma foto.");
  }

  const fonte = await abrirFoto(arquivo);
  const escala = Math.min(1, IMAGEM_LADO_MAX / Math.max(fonte.largura, fonte.altura));
  const largura = Math.max(1, Math.round(fonte.largura * escala));
  const altura = Math.max(1, Math.round(fonte.altura * escala));

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    fonte.liberar();
    throw new Error("Não foi possível preparar a foto.");
  }
  ctx.drawImage(fonte.imagem, 0, 0, largura, altura);
  fonte.liberar();

  let blob = await gerarBlob(canvas, 0.8);
  if (blob.size > IMAGEM_MAX_BYTES) blob = await gerarBlob(canvas, 0.6);
  if (blob.size > IMAGEM_MAX_BYTES) {
    throw new Error("Foto grande demais. Tente outra.");
  }

  const dataUrl = await lerComoDataUrl(blob);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), previa: dataUrl };
}

interface FotoAberta {
  imagem: CanvasImageSource;
  largura: number;
  altura: number;
  liberar: () => void;
}

/**
 * Decodifica a foto. `createImageBitmap` com `imageOrientation: "from-image"`
 * respeita a rotação EXIF, mas falha no Safari antigo do iPhone e em alguns
 * Android com foto de câmera muito grande; aí cai para `<img>`, que nos
 * navegadores atuais também aplica a rotação EXIF ao desenhar no canvas.
 */
async function abrirFoto(arquivo: File): Promise<FotoAberta> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
      return {
        imagem: bitmap,
        largura: bitmap.width,
        altura: bitmap.height,
        liberar: () => bitmap.close(),
      };
    } catch {
      // segue para o <img>
    }
  }

  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    await new Promise<void>((ok, falha) => {
      img.onload = () => ok();
      img.onerror = () => falha(new Error("decodificação"));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("sem dimensões");
    return {
      imagem: img,
      largura: img.naturalWidth,
      altura: img.naturalHeight,
      liberar: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    // HEIC no navegador que não o decodifica, arquivo corrompido…
    throw new Error("Não foi possível abrir esta foto. Tente outra.");
  }
}

async function gerarBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob> {
  const paraBlob = (tipo: string) =>
    new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, qualidade));

  // Safari antigo devolve PNG quando não sabe codificar WebP — PNG de foto é
  // enorme, então confere o tipo devolvido e cai para JPEG.
  const webp = await paraBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await paraBlob("image/jpeg");
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
