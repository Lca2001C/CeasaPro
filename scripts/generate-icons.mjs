// Gera todos os assets de marca (favicon, ícones do PWA e splash screens do iOS)
// sem nenhuma dependência de imagem. Uso: node scripts/generate-icons.mjs
import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Por que este script desenha em vez de converter um SVG.
 *
 * A alternativa natural seria manter um `logo.svg` e rasterizar com `sharp`.
 * Não dá: `sharp` existe aqui só como dependência TRANSITIVA do Next (para a
 * otimização de imagem), não está declarado no `package.json`. Um script do
 * repositório apoiado nisso quebra em silêncio no dia em que o Next trocar de
 * rasterizador ou alguém rodar `npm prune` — e quebra justamente na hora em que
 * a pessoa precisa regerar a marca.
 *
 * Desenhar com `zlib` (que é do Node) tem um custo real: é preciso escrever o
 * PNG e o ICO na mão, e a antisserrilha é feita por amostragem aqui embaixo.
 * Em troca, o único requisito para regerar a marca inteira é ter Node.
 *
 * Este arquivo é a ÚNICA origem dos assets de marca. Para mudar a marca, mude
 * as constantes de geometria e rode o script — não edite os PNG na mão.
 */

// crc32: usa o do zlib (Node >= 20.15); senão, tabela manual.
const crc32 =
  typeof zlibCrc32 === "function"
    ? (buf) => zlibCrc32(buf) >>> 0
    : (() => {
        const table = new Uint32Array(256).map((_, n) => {
          let c = n;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          return c >>> 0;
        });
        return (buf) => {
          let c = 0xffffffff;
          for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
          return (c ^ 0xffffffff) >>> 0;
        };
      })();

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// PNG RGBA de dimensões arbitrárias. `draw(x, y)` retorna [r, g, b, a].
function png(w, h, draw) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0; // filtro: none
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = draw(x, y);
      const o = row + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─────────────────────────── A marca ───────────────────────────

// Identidade CeasaPro: fundo verde + "C" branco (anel com abertura à direita).
// O verde é o mesmo `--primary` do `globals.css` e o mesmo `themeColor` do
// layout — a marca não introduz cor nova.
const GREEN = [26, 122, 63, 255];
const WHITE = [255, 255, 255, 255];

/**
 * Proporções do "C", em fração do diâmetro externo.
 *
 * Estes números foram escolhidos olhando o ícone a **16 pixels**, que é o
 * tamanho em que ele aparece na aba do navegador e no resultado do Google — e
 * não a 512, onde qualquer proporção parece boa. Na versão anterior o anel
 * tinha 12,8% do lado do quadro e a 16px o "C" sumia: virava um borrão
 * esverdeado com um risco claro. Aqui ele tem 18,75%, quase metade mais grosso.
 *
 * `ABERTURA_GRAUS` é o meio-ângulo da falha à direita. Muito abaixo de 45° o
 * "C" fecha e lê como "O"; muito acima ele abre e lê como parêntese.
 */
const RAZAO_INTERNA = 102 / 198; // raio interno ÷ raio externo
const ABERTURA_GRAUS = 45;
/** Diâmetro do "C" como fração do lado do quadro, no ícone cheio. */
const DIAMETRO_NO_ICONE = 2 * (198 / 512);

/**
 * Amostras por eixo, dentro de cada pixel da borda (4 × 4 = 16 por pixel).
 *
 * Sem isto a borda do anel é decidida por um único teste no canto do pixel: o
 * "C" sai serrilhado, e o defeito é invisível a 512px e gritante a 16px — que
 * é exatamente onde ele será visto.
 */
const AMOSTRAS = 4;

function dentroDoAnel(px, py, cx, cy, rOut, rIn) {
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < rIn || d > rOut) return false;
  const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI); // 0 = direita
  return ang > ABERTURA_GRAUS;
}

/**
 * Quanto do pixel (x, y) é coberto pelo "C", de 0 a 1.
 *
 * O atalho pelo raio evita amostrar o miolo e o fundo, que são a esmagadora
 * maioria dos pixels: sem ele uma splash screen de 1290 × 2796 faria 57 milhões
 * de amostras. Só a faixa onde a borda pode cair é amostrada.
 */
function cobertura(x, y, cx, cy, diametro) {
  const rOut = diametro / 2;
  const rIn = rOut * RAZAO_INTERNA;
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > rOut + 1.5 || d < rIn - 1.5) return 0;

  let dentro = 0;
  for (let sy = 0; sy < AMOSTRAS; sy++) {
    for (let sx = 0; sx < AMOSTRAS; sx++) {
      const px = x + (sx + 0.5) / AMOSTRAS;
      const py = y + (sy + 0.5) / AMOSTRAS;
      if (dentroDoAnel(px, py, cx, cy, rOut, rIn)) dentro++;
    }
  }
  return dentro / (AMOSTRAS * AMOSTRAS);
}

/** Mistura verde e branco conforme a cobertura. Ambos opacos: alpha fica 255. */
function pintar(t) {
  if (t <= 0) return GREEN;
  if (t >= 1) return WHITE;
  return [
    Math.round(GREEN[0] + (WHITE[0] - GREEN[0]) * t),
    Math.round(GREEN[1] + (WHITE[1] - GREEN[1]) * t),
    Math.round(GREEN[2] + (WHITE[2] - GREEN[2]) * t),
    255,
  ];
}

/**
 * Ícone quadrado. `zonaSegura` é a fração do quadro que o Android garante não
 * recortar na máscara circular (0,8 é o valor da especificação de maskable);
 * `1` é o ícone cheio.
 */
function iconDraw(size, zonaSegura = 1) {
  const diametro = size * DIAMETRO_NO_ICONE * zonaSegura;
  return (x, y) => pintar(cobertura(x, y, size / 2, size / 2, diametro));
}

/**
 * Splash: fundo verde + "C" pequeno e centrado. Aqui o "C" é marca d'água na
 * tela de abertura, não um ícone — daí ocupar 28% da menor dimensão em vez dos
 * ~77% do ícone.
 */
function splashDraw(w, h) {
  const diametro = Math.min(w, h) * 0.28;
  return (x, y) => pintar(cobertura(x, y, w / 2, h / 2, diametro));
}

/**
 * Monta um `.ico` com várias resoluções embutidas.
 *
 * O formato é um cabeçalho, uma entrada de diretório por imagem, e as imagens
 * concatenadas. O payload aqui é PNG, que o ICO aceita desde o Windows Vista —
 * é o que todo navegador atual e o rastreador do Google leem, e economiza cerca
 * de 15× em bytes contra o DIB não comprimido do formato original.
 *
 * Três tamanhos porque cada consumidor pega um: 16 é a aba do navegador, 32 é a
 * aba em tela de alta densidade, e 48 é o que a documentação do Google pede
 * para o favicon do resultado de busca (múltiplo de 48).
 */
function ico(tamanhos) {
  const imagens = tamanhos.map((n) => png(n, n, iconDraw(n)));
  const CABECALHO = 6;
  const ENTRADA = 16;
  const dir = Buffer.alloc(CABECALHO + ENTRADA * imagens.length);
  dir.writeUInt16LE(0, 0); // reservado
  dir.writeUInt16LE(1, 2); // 1 = ícone (2 seria cursor)
  dir.writeUInt16LE(imagens.length, 4);

  let offset = dir.length;
  imagens.forEach((img, i) => {
    const p = CABECALHO + ENTRADA * i;
    // Largura e altura cabem em um byte, e 0 significa 256 no formato. Nossos
    // tamanhos são menores, mas o resto de 256 deixa a conta certa se alguém
    // acrescentar 256 depois.
    dir.writeUInt8(tamanhos[i] % 256, p);
    dir.writeUInt8(tamanhos[i] % 256, p + 1);
    dir.writeUInt8(0, p + 2); // paleta: nenhuma
    dir.writeUInt8(0, p + 3); // reservado
    dir.writeUInt16LE(1, p + 4); // planos de cor
    dir.writeUInt16LE(32, p + 6); // bits por pixel
    dir.writeUInt32LE(img.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += img.length;
  });

  return Buffer.concat([dir, ...imagens]);
}

// ─────────────────────────── Favicon ───────────────────────────
/*
  Mora em `src/app/`, e não em `public/`, por duas razões. A convenção de
  arquivo do App Router faz o Next emitir o `<link rel="icon">` sozinho; e os
  dois lugares COLIDEM — com o mesmo caminho nos dois, o Next responde
  "A conflicting public file and page file was found for path /favicon.ico".

  O que estava aqui até esta auditoria era o favicon do template do Next
  (círculo preto com triângulo branco), que veio no `create-next-app` e nunca
  foi trocado: o site publicava a marca de outra pessoa na aba do navegador e no
  resultado de busca.
*/
const favicon = ico([16, 32, 48]);
writeFileSync(join(root, "src", "app", "favicon.ico"), favicon);
console.log(`✔ src/app/favicon.ico (16+32+48, ${favicon.length} bytes)`);

// ─────────────────────────── Ícones ───────────────────────────
mkdirSync(join(root, "public", "icons"), { recursive: true });
const icons = [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["apple-touch-icon.png", 180, 1],
  ["icon-maskable-512.png", 512, 0.8], // zona segura da máscara do Android
];
for (const [file, size, zonaSegura] of icons) {
  const buf = png(size, size, iconDraw(size, zonaSegura));
  writeFileSync(join(root, "public", "icons", file), buf);
  console.log(`✔ public/icons/${file} (${size}x${size}, ${buf.length} bytes)`);
}

// ─────────────────────── Splash screens iOS ───────────────────────
// Mesma lista de devices usada por src/lib/pwa/ios-splash.ts (fonte única).
mkdirSync(join(root, "public", "splash"), { recursive: true });
const devices = JSON.parse(
  readFileSync(join(root, "src", "lib", "pwa", "ios-splash-devices.json"), "utf8"),
);
const written = new Set();
for (const { w, h, dpr } of devices) {
  const pw = w * dpr;
  const ph = h * dpr;
  for (const [ow, oh] of [
    [pw, ph], // retrato
    [ph, pw], // paisagem
  ]) {
    const file = `apple-splash-${ow}-${oh}.png`;
    if (written.has(file)) continue; // devices distintos podem colidir em px
    written.add(file);
    const buf = png(ow, oh, splashDraw(ow, oh));
    writeFileSync(join(root, "public", "splash", file), buf);
    console.log(`✔ public/splash/${file} (${ow}x${oh}, ${buf.length} bytes)`);
  }
}
console.log(`\nConcluído: favicon + ${icons.length} ícones + ${written.size} splash screens.`);
