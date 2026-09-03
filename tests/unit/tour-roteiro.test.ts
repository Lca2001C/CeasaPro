import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPITULOS,
  ROTA_INICIAL,
  capitulosDoPlano,
  localizar,
  type CapituloTour,
} from "@/lib/tour/roteiro";
import { ALL_OPTIONAL_KEYS } from "@/lib/plan/modules";

/**
 * O tour guiado depende de duas coisas que quebram em silêncio:
 *
 * 1. **A âncora.** O passo aponta para `[data-tour="x"]`. Se alguém renomear o
 *    atributo na página, nada falha em build nem em tipo — o tour simplesmente
 *    passa a destacar o vazio. Por isso o primeiro teste confere os seletores do
 *    roteiro contra os atributos que existem de verdade no código-fonte.
 *
 * 2. **A contagem entre telas.** O progresso ("9 de 21") é calculado a partir
 *    dos capítulos anteriores, e o botão Voltar atravessa telas pelo mesmo
 *    cálculo. Um erro de um passo aqui não aparece na primeira tela, só no meio
 *    do tour.
 */

const RAIZ_SRC = join(process.cwd(), "src");

/** Todos os arquivos .ts/.tsx de `src`, recursivamente. */
function arquivosFonte(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) return arquivosFonte(caminho);
    return /\.tsx?$/.test(entrada.name) ? [caminho] : [];
  });
}

/**
 * As âncoras que existem no código.
 *
 * Duas formas contam: o atributo literal (`data-tour="x"`, o caso comum) e o
 * parâmetro `ancoraTour="x"`, usado onde envolver o elemento num `<div>` mudaria
 * o layout (ver `SecaoRecolhivel`).
 */
function ancorasNoCodigo(): Set<string> {
  const encontradas = new Set<string>();
  for (const arquivo of arquivosFonte(RAIZ_SRC)) {
    const conteudo = readFileSync(arquivo, "utf8");
    for (const m of conteudo.matchAll(/(?:data-tour|ancoraTour)="([^"]+)"/g)) {
      encontradas.add(m[1]);
    }
  }
  return encontradas;
}

/** Os nomes de âncora que um seletor do roteiro exige. */
function ancorasDoSeletor(seletor: string): string[] {
  return [...seletor.matchAll(/\[data-tour="([^"]+)"\]/g)].map((m) => m[1]);
}

function todosOsPassos(capitulos: CapituloTour[]) {
  return capitulos.flatMap((c) => c.passos.map((p) => ({ rota: c.rota, ...p })));
}

describe("roteiro do tour — âncoras", () => {
  it("todo passo com alvo aponta para uma âncora que existe no código", () => {
    const existentes = ancorasNoCodigo();

    for (const passo of todosOsPassos(CAPITULOS)) {
      if (!passo.alvo) continue;
      const exigidas = ancorasDoSeletor(passo.alvo);
      // Um seletor sem `[data-tour=...]` seria um acoplamento com marcação
      // qualquer (uma classe do Tailwind, por exemplo), que muda sem aviso.
      expect(
        exigidas.length,
        `"${passo.titulo}" (${passo.rota}) usa um seletor sem data-tour: ${passo.alvo}`,
      ).toBeGreaterThan(0);

      for (const ancora of exigidas) {
        expect(
          existentes.has(ancora),
          `"${passo.titulo}" (${passo.rota}) aponta para data-tour="${ancora}", que não existe em src/`,
        ).toBe(true);
      }
    }
  });

  it("o passo da navegação cobre as duas barras (celular e computador)", () => {
    const navegacao = todosOsPassos(CAPITULOS).filter((p) =>
      p.alvo?.includes("nav-"),
    );
    expect(navegacao).toHaveLength(1);
    // Só uma delas está visível por vez; o passo tem de aceitar as duas, senão
    // o tour destaca a barra escondida em metade dos aparelhos.
    expect(ancorasDoSeletor(navegacao[0].alvo!).sort()).toEqual([
      "nav-desktop",
      "nav-mobile",
    ]);
  });
});

describe("roteiro do tour — forma", () => {
  it("começa no Início", () => {
    expect(ROTA_INICIAL).toBe("/dashboard");
    expect(CAPITULOS[0].rota).toBe(ROTA_INICIAL);
  });

  it("não entra na frente de caixa", () => {
    // Regra de produto, não detalhe de implementação: é a única tela em que pode
    // haver uma venda começada e um cliente esperando. Cobrir isso com um balão
    // modal é atrapalhar trabalho em andamento.
    expect(CAPITULOS.map((c) => c.rota)).not.toContain("/vendas/nova");
  });

  it("não repete tela e todo capítulo tem passo", () => {
    const rotas = CAPITULOS.map((c) => c.rota);
    expect(new Set(rotas).size).toBe(rotas.length);
    for (const c of CAPITULOS) {
      expect(c.passos.length, `capítulo ${c.rota} está vazio`).toBeGreaterThan(0);
    }
  });

  it("o primeiro passo não tem alvo — é a abertura, centralizada", () => {
    expect(CAPITULOS[0].passos[0].alvo).toBeUndefined();
  });
});

describe("capitulosDoPlano", () => {
  it("sem o claim de módulos (token legado) libera tudo", () => {
    expect(capitulosDoPlano(undefined)).toHaveLength(CAPITULOS.length);
  });

  it("plano sem módulo opcional nenhum deixa só o núcleo", () => {
    const nucleo = capitulosDoPlano([]);
    expect(nucleo.every((c) => c.modulo === undefined)).toBe(true);
    expect(nucleo.length).toBeLessThan(CAPITULOS.length);
    // O núcleo é o que todo plano tem: compra, venda, estoque, fiado, despesa.
    for (const rota of ["/dashboard", "/produtos", "/compras", "/estoque", "/fiado"]) {
      expect(nucleo.map((c) => c.rota)).toContain(rota);
    }
  });

  it("cada módulo opcional libera exatamente o seu capítulo", () => {
    for (const chave of ALL_OPTIONAL_KEYS) {
      const comEle = capitulosDoPlano([chave]);
      const daquiParaFora = comEle.filter((c) => c.modulo !== undefined);
      expect(daquiParaFora.every((c) => c.modulo === chave)).toBe(true);
    }
  });

  it("preserva a ordem do roteiro", () => {
    const parcial = capitulosDoPlano(["higienizacao"]);
    const esperada = CAPITULOS.filter(
      (c) => !c.modulo || c.modulo === "higienizacao",
    ).map((c) => c.rota);
    expect(parcial.map((c) => c.rota)).toEqual(esperada);
  });
});

describe("localizar", () => {
  it("o primeiro capítulo abre em 1 e não tem tela anterior", () => {
    const capitulos = capitulosDoPlano(undefined);
    const local = localizar(capitulos, "/dashboard")!;

    expect(local.deslocamento).toBe(1);
    expect(local.rotaAnterior).toBeNull();
    expect(local.proximaRota).toBe(capitulos[1].rota);
  });

  it("o deslocamento continua a contagem da tela anterior", () => {
    const capitulos = capitulosDoPlano(undefined);
    let esperado = 1;
    for (const capitulo of capitulos) {
      expect(localizar(capitulos, capitulo.rota)!.deslocamento).toBe(esperado);
      esperado += capitulo.passos.length;
    }
    // Somados, os deslocamentos cobrem o total exatamente uma vez.
    expect(esperado - 1).toBe(localizar(capitulos, "/dashboard")!.total);
  });

  it("o último capítulo não tem próxima tela", () => {
    const capitulos = capitulosDoPlano(undefined);
    const ultimo = capitulos[capitulos.length - 1];
    const local = localizar(capitulos, ultimo.rota)!;

    expect(local.proximaRota).toBeNull();
    // O último balão fecha o tour: é ele que mostra o "Terminar".
    expect(local.deslocamento + ultimo.passos.length - 1).toBe(local.total);
  });

  it("o total acompanha o plano", () => {
    const completo = localizar(capitulosDoPlano(undefined), "/dashboard")!;
    const basico = localizar(capitulosDoPlano([]), "/dashboard")!;
    expect(basico.total).toBeLessThan(completo.total);
  });

  it("tela fora do roteiro devolve null", () => {
    const capitulos = capitulosDoPlano(undefined);
    expect(localizar(capitulos, "/vendas/nova")).toBeNull();
    expect(localizar(capitulos, "/configuracoes")).toBeNull();
  });

  it("tela que o plano tirou devolve null — é o que encerra o tour em paz", () => {
    // Com o módulo, o capítulo existe; sem ele, some. Se `localizar` devolvesse
    // qualquer coisa aqui, o tour insistiria numa tela que o middleware bloqueia.
    expect(localizar(capitulosDoPlano(["caixas"]), "/caixas-plasticas")).not.toBeNull();
    expect(localizar(capitulosDoPlano([]), "/caixas-plasticas")).toBeNull();
  });

  it("costura as telas em cadeia, ida e volta", () => {
    const capitulos = capitulosDoPlano([]);
    for (let i = 0; i < capitulos.length; i++) {
      const local = localizar(capitulos, capitulos[i].rota)!;
      expect(local.proximaRota).toBe(capitulos[i + 1]?.rota ?? null);
      expect(local.rotaAnterior).toBe(capitulos[i - 1]?.rota ?? null);
    }
  });
});
