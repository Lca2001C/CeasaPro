import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { config } from "@/proxy";
import { landingJsonLd, organizationLd, LOGO_URL, CANONICAL_ORIGIN } from "@/lib/seo/landing";
import manifest from "@/app/manifest";

/**
 * A marca — o que o navegador mostra na aba e o Google mostra no resultado.
 *
 * Este arquivo existe por causa de um defeito que estava publicado: o
 * `src/app/favicon.ico` era o ícone do TEMPLATE do Next (círculo preto com
 * triângulo branco), que veio no `create-next-app` e nunca foi trocado. O site
 * anunciava a marca de outra pessoa, e nada no CI reparava — ícone é um binário,
 * e binário não aparece em revisão de diff.
 *
 * Nenhuma asserção aqui é sobre bytes exatos: comparar o arquivo inteiro com um
 * blob commitado trava a marca e falha por qualquer reencode, sem dizer o que
 * mudou. O que se afirma são as PROPRIEDADES que fazem o ícone funcionar — que
 * ele é a marca (verde e branco, não preto), que tem os tamanhos que cada
 * consumidor pega, e que um rastreador sem cookie o alcança.
 */

// Caminhos relativos à raiz do repositório: o Vitest roda a partir dela, e é
// como os outros guardas que leem fonte (`actions-module-gate`) já fazem.
const arquivo = (p: string) => readFileSync(p);

// ─────────────────────── leitores de formato ───────────────────────

/** Entradas de um `.ico`: tamanho declarado e o payload de cada uma. */
function lerIco(buf: Buffer) {
  expect(buf.readUInt16LE(0), "campo reservado").toBe(0);
  expect(buf.readUInt16LE(2), "tipo (1 = ícone)").toBe(1);
  const total = buf.readUInt16LE(4);
  return Array.from({ length: total }, (_, i) => {
    const p = 6 + 16 * i;
    const tamanho = buf.readUInt8(p) || 256;
    const off = buf.readUInt32LE(p + 12);
    const payload = buf.subarray(off, off + buf.readUInt32LE(p + 8));
    return { tamanho, altura: buf.readUInt8(p + 1) || 256, payload };
  });
}

/**
 * Decodifica um PNG RGBA de 8 bits sem filtro de linha.
 *
 * Só serve para os PNG que `scripts/generate-icons.mjs` escreve (filtro 0,
 * cor 6) — e é exatamente por isso que serve: se alguém trocar os ícones por
 * arquivos vindos de outra ferramenta, este leitor recusa em vez de aceitar em
 * silêncio um ícone que ninguém sabe de onde veio.
 */
function lerPng(buf: Buffer) {
  expect(buf.subarray(0, 8).toString("hex"), "assinatura PNG").toBe("89504e470d0a1a0a");
  const idat: Buffer[] = [];
  let largura = 0;
  let altura = 0;
  let pos = 8;
  while (pos < buf.length) {
    const tam = buf.readUInt32BE(pos);
    const tipo = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const dados = buf.subarray(pos + 8, pos + 8 + tam);
    if (tipo === "IHDR") {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      expect(dados[8], "profundidade de bits").toBe(8);
      expect(dados[9], "tipo de cor (6 = RGBA)").toBe(6);
    }
    if (tipo === "IDAT") idat.push(Buffer.from(dados));
    pos += 12 + tam;
  }
  const cru = inflateSync(Buffer.concat(idat));
  const pixels: Array<[number, number, number, number]> = [];
  for (let y = 0; y < altura; y++) {
    const linha = y * (1 + largura * 4);
    expect(cru[linha], "filtro da linha").toBe(0);
    for (let x = 0; x < largura; x++) {
      const o = linha + 1 + x * 4;
      pixels.push([cru[o]!, cru[o + 1]!, cru[o + 2]!, cru[o + 3]!]);
    }
  }
  return { largura, altura, pixels };
}

const VERDE = [26, 122, 63];
const perto = (c: number[], alvo: number[], tolerancia = 12) =>
  c.slice(0, 3).every((v, i) => Math.abs(v - alvo[i]!) <= tolerancia);

/**
 * Fração do quadro coberta de branco, contando a borda suavizada pelo que ela
 * vale — 0 é só fundo, 1 seria tudo branco.
 *
 * Contar apenas o branco PURO não serve para medir a marca: a 16px quase todo
 * o "C" é mistura, não branco puro, e o mesmo desenho mediria 0,17 a 16px e
 * 0,26 a 512px. Como os dois tons são conhecidos e a mistura é linear, dá para
 * recuperar quanto de branco há em cada pixel pelo canal vermelho (26 no verde,
 * 255 no branco) — e aí a medida é a MESMA em qualquer resolução, que é o que
 * permite um único piso valer para o `.ico` e para o PNG de 512.
 */
function tinta(pixels: Array<[number, number, number, number]>) {
  const soma = pixels.reduce((acc, p) => acc + (p[0] - VERDE[0]!) / (255 - VERDE[0]!), 0);
  return soma / pixels.length;
}

/** Conta verde de marca, branco e "escuro demais para ser qualquer um dos dois". */
function classificar(pixels: Array<[number, number, number, number]>) {
  let verde = 0;
  let branco = 0;
  let escuro = 0;
  for (const p of pixels) {
    if (perto(p, VERDE)) verde++;
    else if (perto(p, [255, 255, 255])) branco++;
    if (p[0] + p[1] + p[2] < 90) escuro++;
  }
  return { verde, branco, escuro, total: pixels.length };
}

// ─────────────────────────── o favicon ───────────────────────────

describe("favicon", () => {
  it("mora em src/app/ e NÃO em public/ — os dois lugares colidem", () => {
    /*
      Com o mesmo caminho nos dois, o Next responde "A conflicting public file
      and page file was found for path /favicon.ico" e a rota morre. A posição
      em `src/app/` também é a que faz o Next emitir o `<link rel="icon">`
      sozinho.
    */
    expect(existsSync("src/app/favicon.ico")).toBe(true);
    expect(existsSync("public/favicon.ico")).toBe(false);
  });

  const entradas = lerIco(arquivo("src/app/favicon.ico"));

  it("traz 16, 32 e 48 — cada consumidor pega um", () => {
    // 16 é a aba; 32 é a aba em tela de alta densidade; 48 é o que a
    // documentação do Google pede para o favicon do resultado de busca.
    expect(entradas.map((e) => e.tamanho).sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });

  it("é quadrado em todas as resoluções", () => {
    // Google descarta favicon não quadrado — e volta a mostrar o globo genérico.
    for (const e of entradas) expect(e.altura, `${e.tamanho}px`).toBe(e.tamanho);
  });

  it("os payloads são PNG, não DIB", () => {
    for (const e of entradas) {
      expect(e.payload.subarray(0, 4).toString("hex"), `${e.tamanho}px`).toBe("89504e47");
    }
  });

  it("é a marca do CeasaPro, e não o ícone do template do Next", () => {
    /*
      A asserção que pega o defeito que estava publicado. O ícone do template é
      um círculo PRETO com triângulo branco; o nosso é fundo verde de marca com
      um "C" branco. Olhar pixel é a única forma — o nome do arquivo é o mesmo
      nos dois casos.
    */
    for (const e of entradas) {
      const { pixels } = lerPng(e.payload);
      const { verde, branco, escuro, total } = classificar(pixels);

      expect(verde / total, `${e.tamanho}px: fundo verde de marca`).toBeGreaterThan(0.5);
      expect(branco / total, `${e.tamanho}px: o "C" branco`).toBeGreaterThan(0.15);
      expect(escuro / total, `${e.tamanho}px: preto do template`).toBeLessThan(0.01);
    }
  });

  it("o traço é grosso o bastante para ler a 16px, e fino o bastante para ser um 'C'", () => {
    /*
      16px é o tamanho de uso real — a aba e o resultado de busca — e é onde a
      marca morre primeiro. A versão anterior deste gerador desenhava um anel de
      12,8% do lado do quadro, o que dá 0,154 de tinta: a 16px sobravam uns
      poucos pixels claros e o "C" virava um borrão esverdeado com um risco.
      O desenho atual dá 0,259, medido, e foi conferido a olho ampliado.

      O teto existe para o erro oposto: sem ele, fechar a abertura ou engrossar
      o traço até virar um disco branco (0,47) passaria como "mais legível".
      Marca ilegível e marca que virou uma bolha são o mesmo defeito.
    */
    for (const e of entradas) {
      const medida = tinta(lerPng(e.payload).pixels);
      expect(medida, `${e.tamanho}px: traço fino demais`).toBeGreaterThan(0.2);
      expect(medida, `${e.tamanho}px: deixou de ser um "C"`).toBeLessThan(0.35);
    }
  });
});

// ─────────────────────────── os PNG do PWA ───────────────────────────

describe("ícones do PWA", () => {
  const esperados = [
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/apple-touch-icon.png", 180],
    ["public/icons/icon-maskable-512.png", 512],
  ] as const;

  for (const [caminho, lado] of esperados) {
    it(`${caminho} é ${lado}×${lado} e está na marca`, () => {
      const { largura, altura, pixels } = lerPng(arquivo(caminho));
      expect(largura).toBe(lado);
      expect(altura).toBe(lado);

      const { verde, branco, escuro, total } = classificar(pixels);
      expect(verde / total).toBeGreaterThan(0.5);
      expect(branco / total).toBeGreaterThan(0.1);
      expect(escuro / total).toBeLessThan(0.01);
    });
  }

  it("o maskable recua para a zona segura de 80% do Android", () => {
    /*
      A máscara circular do Android recorta o que passa de ~80% do quadro. Se o
      maskable saísse na mesma escala do ícone cheio, as pontas do "C" seriam
      cortadas no aparelho — e só lá, nunca no navegador de quem desenvolve.

      Área escala com o quadrado do lado, então recuar para 80% tem de deixar a
      tinta em 0,8² = 64% da do ícone cheio. Afirmar a RAZÃO, e não só "é menor",
      é o que distingue a zona segura correta de um encolhimento qualquer.
    */
    const cheio = tinta(lerPng(arquivo("public/icons/icon-512.png")).pixels);
    const mascara = tinta(lerPng(arquivo("public/icons/icon-maskable-512.png")).pixels);
    expect(mascara / cheio).toBeCloseTo(0.8 ** 2, 2);
  });

  it("todos saem do mesmo gerador, que é a única origem da marca", () => {
    // Dois geradores para os mesmos arquivos é como os ícones divergem: mexe-se
    // num e esquecem-se os outros, e nenhum teste olha pixel.
    const gerador = arquivo("scripts/generate-icons.mjs").toString("utf8");
    for (const [caminho] of esperados) {
      expect(gerador, caminho).toContain(caminho.replace("public/icons/", ""));
    }
    expect(gerador).toContain("favicon.ico");
    expect(existsSync("scripts/gerar-marca.mjs"), "gerador duplicado").toBe(false);
  });
});

// ────────────────── alcance: o rastreador não tem cookie ──────────────────

describe("um rastreador sem sessão alcança a marca", () => {
  /*
    A armadilha que já se materializou uma vez nesta base, com a imagem de link:
    o que passa pelo proxy sem sessão leva redirect para `/login`, e o Google
    registra o ícone como inalcançável. O matcher exclui `icons/` e
    `favicon.ico$` — este teste é o que impede alguém de tirar.
  */
  const passaPeloProxy = (caminho: string) =>
    new RegExp(`^${config.matcher[0]}$`).test(caminho);

  const publicos = [
    "/favicon.ico",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/apple-touch-icon.png",
    "/icons/icon-maskable-512.png",
    "/manifest.webmanifest",
  ];

  for (const caminho of publicos) {
    it(`${caminho} fica FORA do middleware`, () => {
      expect(passaPeloProxy(caminho)).toBe(false);
    });
  }

  it("todo ícone do manifesto está na lista pública acima", () => {
    // O manifesto pode ganhar ícone novo sem ninguém lembrar do proxy; aqui a
    // lista é conferida contra a fonte em vez de ficar congelada.
    for (const icone of manifest().icons ?? []) {
      expect(passaPeloProxy(icone.src), icone.src).toBe(false);
    }
  });

  it("a exclusão continua ancorada — /icons-secretos NÃO escapa", () => {
    // Sem a barra final em `icons/`, qualquer caminho começando por "icons"
    // sairia do middleware. É o furo que `proxy-matcher.test.ts` documenta.
    expect(passaPeloProxy("/icons-secretos/lista")).toBe(true);
    expect(passaPeloProxy("/favicon.ico/x")).toBe(true);
  });
});

// ─────────────────── o que o layout declara ───────────────────

describe("metadata.icons do layout", () => {
  const layout = arquivo("src/app/layout.tsx").toString("utf8");

  it("NÃO declara o .ico — o Next já o injeta, e sairia duplicado", () => {
    /*
      As duas origens de ícone do Next não são simétricas, e a diferença não
      está na documentação: `src/app/favicon.ico` entra com
      `icon.unshift(favicon)` SEMPRE, mesmo com `metadata.icons` declarado; os
      demais arquivos de convenção são ignorados quando ele existe.
    */
    const dentroDeIcons = layout.slice(layout.indexOf("icons: {"), layout.indexOf("};"));
    expect(dentroDeIcons).not.toContain("favicon.ico");
  });

  it("declara os PNG, que a convenção não dá", () => {
    expect(layout).toContain('url: "/icons/icon-192.png"');
    expect(layout).toContain('apple: "/icons/apple-touch-icon.png"');
  });
});

// ─────────────────────── o logotipo no JSON-LD ───────────────────────

describe("Organization no JSON-LD", () => {
  it("existe, e é o nó que carrega o logotipo", () => {
    // Antes desta mudança a landing publicava só `SoftwareApplication`: não
    // havia `logo` nenhum na página, e a única pista de marca para o Google era
    // o favicon — que estava errado.
    const grafo = landingJsonLd()["@graph"];
    const org = grafo.find((n) => (n as { "@type": string })["@type"] === "Organization");
    expect(org).toBeDefined();
  });

  it("o logotipo é URL absoluta, https, e aponta para arquivo que existe", () => {
    // Caminho relativo não serve: quem lê é um rastreador que pode ter obtido o
    // JSON fora do contexto da página.
    expect(LOGO_URL.startsWith("https://")).toBe(true);
    expect(organizationLd().logo).toBe(LOGO_URL);

    const caminho = new URL(LOGO_URL).pathname;
    expect(existsSync("public" + caminho), caminho).toBe(true);
  });

  it("o logotipo tem pelo menos 112px, que é o piso do Google", () => {
    const { largura, altura } = lerPng(arquivo("public" + new URL(LOGO_URL).pathname));
    expect(largura).toBeGreaterThanOrEqual(112);
    expect(largura).toBe(altura);
  });

  it("o produto referencia a organização pelo mesmo @id", () => {
    /*
      Sem esta amarração o Google vê dois objetos soltos no grafo e não liga o
      logotipo a esta aplicação. `@id` é o único vínculo entre eles.
    */
    const grafo = landingJsonLd()["@graph"] as Array<Record<string, unknown>>;
    const org = grafo.find((n) => n["@type"] === "Organization")!;
    const app = grafo.find((n) => n["@type"] === "SoftwareApplication")!;
    expect((app.publisher as { "@id": string })["@id"]).toBe(org["@id"]);
    expect(org["@id"]).toContain(CANONICAL_ORIGIN);
  });

  it("o grafo tem um único @context, na raiz", () => {
    const doc = landingJsonLd();
    expect(doc["@context"]).toBe("https://schema.org");
    for (const no of doc["@graph"] as Array<Record<string, unknown>>) {
      expect(no["@context"], JSON.stringify(no["@type"])).toBeUndefined();
    }
  });
});
