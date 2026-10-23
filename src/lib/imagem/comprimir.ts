import { classificarFoto, IMAGEM_LADO_MAX, IMAGEM_MAX_BYTES } from "./formato";

/**
 * Copia a foto para a memória ANTES de limpar o `<input>`.
 *
 * No Android, a câmera devolve um blob `content://`. Zerar `input.value` na
 * hora revoga esse blob e a decodificação falha — a galeria não sofre isso,
 * porque o arquivo dela já está no disco do aparelho. O tipo também mente:
 * vários celulares mandam JPEG com `application/octet-stream`, e o iPhone
 * manda HEIC. Aqui o tipo passa a ser o dos bytes.
 */
export async function copiarFoto(arquivo: File): Promise<File> {
  const bytes = await arquivo.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("A câmera não entregou a foto. Tire outra.");
  }
  const u8 = new Uint8Array(bytes);
  const tipo = classificarFoto(u8, arquivo.type);
  const nome = tipo === "image/heic" ? arquivo.name || "foto.heic" : arquivo.name || "foto.jpg";
  return new File([bytes], nome, { type: tipo });
}

/** HEIC/HEIF do iPhone → JPEG, só quando a foto é desse tipo. O decodificador não entra no carregamento da tela. */
async function heicParaJpeg(arquivo: File): Promise<File> {
  try {
    const { default: heic2any } = await import("heic2any");
    const saida = await heic2any({ blob: arquivo, toType: "image/jpeg", quality: 0.82 });
    const blob = Array.isArray(saida) ? saida[0] : saida;
    if (!blob || blob.size === 0) throw new Error("vazio");
    return new File([blob], "foto.jpg", { type: "image/jpeg" });
  } catch {
    throw new Error("Não foi possível abrir esta foto. Tente outra.");
  }
}

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
  // Um só caminho: classifica pelos bytes, HEIC vira JPEG, e todo o resto
  // entra no funil (lado de 1024 px, alvo ~400 KB). O Postgres guarda a chave.
  const copia = await copiarFoto(arquivo);
  const legivel = copia.type === "image/heic" ? await heicParaJpeg(copia) : copia;
  const fonte = await abrirFoto(legivel);
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
    // Reduz JÁ na decodificação. Foto de câmera de 12–48 MP estoura a memória
    // do celular se o bitmap inteiro nascer primeiro; a galeria costuma vir menor.
    const tentativas: ImageBitmapOptions[] = [
      { imageOrientation: "from-image", resizeWidth: IMAGEM_LADO_MAX, resizeQuality: "high" },
      { resizeWidth: IMAGEM_LADO_MAX, resizeQuality: "high" },
      { imageOrientation: "from-image" },
      {},
    ];
    for (const opcoes of tentativas) {
      try {
        const bitmap = await createImageBitmap(arquivo, opcoes);
        if (bitmap.width > 0 && bitmap.height > 0) return devolverBitmap(bitmap);
        bitmap.close();
      } catch {
        // opção que este aparelho não aceita: tenta a próxima
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
