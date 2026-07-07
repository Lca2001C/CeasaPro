// Gera os ícones PNG do PWA (fundo verde + "C" branco) sem dependências de imagem.
// Uso: node scripts/generate-icons.mjs
import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
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

function png(size, draw) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // filtro: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const o = row + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
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

// Fundo verde CeasaPro + letra "C" branca (anel com abertura à direita).
const GREEN = [26, 122, 63, 255];
const WHITE = [255, 255, 255, 255];

function drawIcon(x, y, size) {
  const c = size / 2;
  const dx = x - c;
  const dy = y - c;
  const d = Math.sqrt(dx * dx + dy * dy);
  const rOut = size * 0.32;
  const rIn = size * 0.19;
  if (d >= rIn && d <= rOut) {
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180 (0 = direita)
    if (Math.abs(ang) > 42) return WHITE; // abertura do "C" à direita
  }
  return GREEN;
}

mkdirSync(join(root, "public", "icons"), { recursive: true });
for (const [file, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  const buf = png(size, drawIcon);
  writeFileSync(join(root, "public", "icons", file), buf);
  console.log(`✔ public/icons/${file} (${size}x${size}, ${buf.length} bytes)`);
}
