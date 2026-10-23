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
  let blob: Blob | null = null;
  try {
    // Vai diminuindo lado e qualidade até caber. Foto de câmera de 50 MP, PNG
    // de captura de tela… tudo termina abaixo do alvo em vez de dar erro.
    for (const [lado, qualidade] of TENTATIVAS) {
      const candidato = await desenhar(fonte, lado, qualidade);
      blob = candidato;
      if (candidato.size <= ALVO_BYTES) break;
    }
  } finally {
    fonte.liberar();
  }
  if (!blob || blob.size > IMAGEM_MAX_BYTES) {
    throw new Error("Não foi possível reduzir esta foto. Tente outra.");
  }

  const dataUrl = await lerComoDataUrl(blob);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), previa: dataUrl };
}

/** Alvo folgado: bem abaixo do teto do servidor, mesmo somando o base64. */
const ALVO_BYTES = Math.min(400 * 1024, IMAGEM_MAX_BYTES);

/** [lado maior em px, qualidade], da melhor para a menor. */
const TENTATIVAS: [number, number][] = [
  [IMAGEM_LADO_MAX, 0.8],
  [IMAGEM_LADO_MAX, 0.65],
  [800, 0.6],
  [640, 0.55],
  [480, 0.5],
  [360, 0.45],
];

async function desenhar(fonte: FotoAberta, ladoMax: number, qualidade: number): Promise<Blob> {
  const escala = Math.min(1, ladoMax / Math.max(fonte.largura, fonte.altura));
  const largura = Math.max(1, Math.round(fonte.largura * escala));
  const altura = Math.max(1, Math.round(fonte.altura * escala));
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a foto.");
  // Fundo branco: PNG com transparência viraria preto no JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(fonte.imagem, 0, 0, largura, altura);
  try {
    return await gerarBlob(canvas, qualidade);
  } finally {
    // Libera a memória do canvas na hora — o Safari do iPhone tem teto baixo.
    canvas.width = 0;
    canvas.height = 0;
  }
}

interface FotoAberta {
  imagem: CanvasImageSource;
  largura: number;
  altura: number;
  liberar: () => void;
}

async function devolverBitmap(bitmap: ImageBitmap): Promise<FotoAberta> {
  // Foto gigante: reduz já na decodificação para não estourar a memória do
  // canvas no celular (iPhone recusa canvas acima de ~16 MP).
  if (Math.max(bitmap.width, bitmap.height) > IMAGEM_LADO_MAX * 2) {
    const escala = (IMAGEM_LADO_MAX * 2) / Math.max(bitmap.width, bitmap.height);
    try {
      const menor = await createImageBitmap(bitmap, {
        resizeWidth: Math.round(bitmap.width * escala),
        resizeHeight: Math.round(bitmap.height * escala),
        resizeQuality: "high",
      });
      bitmap.close();
      return {
        imagem: menor,
        largura: menor.width,
        altura: menor.height,
        liberar: () => menor.close(),
      };
    } catch {
      // sem suporte a resize: usa o bitmap inteiro
    }
  }
  return {
    imagem: bitmap,
    largura: bitmap.width,
    altura: bitmap.height,
    liberar: () => bitmap.close(),
  };
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
      return devolverBitmap(bitmap);
    } catch {
      try {
        // Sem `imageOrientation`: Safari antigo e Android com JPEG da câmera
        // recusam o dicionário de opções, mas abrem o arquivo sozinhos.
        const bitmap = await createImageBitmap(arquivo);
        return devolverBitmap(bitmap);
      } catch {
        // segue para o <img>
      }
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
