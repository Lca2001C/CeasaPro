// Gera os assets PNG do PWA (ícones + splash screens do iOS) sem dependências de imagem.
// Uso: node scripts/generate-icons.mjs
import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

// Identidade CeasaPro: fundo verde + letra "C" branca (anel com abertura à direita).
const GREEN = [26, 122, 63, 255];
const WHITE = [255, 255, 255, 255];

/**
 * Desenha o "C" branco centrado em (cx, cy) com diâmetro externo = `logo`.
 * `pad` (0..1) é a fração de safe-zone: quanto maior, menor o logo (para maskable).
 * Retorna WHITE se o pixel pertence ao anel, senão null (deixa o fundo).
 */
function letterC(x, y, cx, cy, logo) {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  const rOut = logo * 0.5;
  const rIn = logo * 0.3;
  if (d >= rIn && d <= rOut) {
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = direita
    if (Math.abs(ang) > 42) return WHITE; // abertura do "C" à direita
  }
  return null;
}

// Ícone quadrado. `safe` = fração de padding (0 = logo cheio; 0.4 = maskable).
function iconDraw(size, safe = 0) {
  const logo = size * (0.64 - safe); // 0.64 do quadro no ícone normal
  return (x, y) => letterC(x, y, size / 2, size / 2, logo) ?? GREEN;
}

// Splash: fundo verde + "C" pequeno centrado (logo ~28% da menor dimensão).
function splashDraw(w, h) {
  const logo = Math.min(w, h) * 0.28;
  return (x, y) => letterC(x, y, w / 2, h / 2, logo) ?? GREEN;
}

// ─────────────────────────── Ícones ───────────────────────────
mkdirSync(join(root, "public", "icons"), { recursive: true });
const icons = [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["apple-touch-icon.png", 180, 0],
  ["icon-maskable-512.png", 512, 0.4], // safe-zone p/ máscara do Android
];
for (const [file, size, safe] of icons) {
  const buf = png(size, size, iconDraw(size, safe));
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
console.log(`\nConcluído: ${icons.length} ícones + ${written.size} splash screens.`);
