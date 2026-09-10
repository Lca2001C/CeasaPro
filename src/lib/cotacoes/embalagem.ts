import { Decimal, money, toDecimal, type Numeric } from "@/lib/money";
import type { SaleUnit } from "@prisma/client";

/**
 * A embalagem do boletim: o que ela pesa e quanto sai o quilo.
 *
 * Funções puras, sem Prisma nem React — no molde de `variacao.ts` e `frescor.ts`.
 *
 * O problema que este arquivo resolve: `ceasa_quotes.unit` é TEXTO LIVRE, do jeito
 * que a fonte imprime, e o boletim cota o mesmo item em embalagens de ordem de
 * grandeza diferente. Medido no boletim real da CEASAMINAS
 * (`tests/fixtures/cotacoes/ceasaminas-ok.html`, 215 linhas):
 *
 *     KG              173 linhas
 *     DZ               14
 *     CX 30 DZ          5
 *     DZ 4 KG           4
 *     MC/M 0,07 KG      3
 *     CX 06 UN          2
 *     DZ 6 KG / DZ 7 KG / DZ 8 KG / DZ 10 KG / DZ 3 KG / DZ 1,70 KG
 *     UN 1,5 KG / MO 0,33 KG / BAND 0,4 KG / CX 50 DZ
 *
 * A forma é sempre a mesma: sigla da embalagem e, QUANDO A FONTE SABE, o peso
 * equivalente em quilos. É esse peso declarado que permite dizer "≈ R$ 4,20/kg"
 * ao lado de um preço de caixa.
 *
 * A regra que governa tudo aqui: **peso que o boletim não declarou não é
 * adivinhado**. `DZ` é uma dúzia de quê? `CX 30 DZ` são trinta dúzias de um item
 * cujo peso ninguém publicou. Chutar 12 kg para essas linhas produziria um
 * R$/kg plausível e errado — o tipo de número que o comerciante repassa ao preço
 * do balcão sem desconfiar. Nesses casos a resposta é `null`, e a tela mostra
 * só o preço da embalagem, que é o dado que existe de verdade.
 */

/**
 * O que a embalagem pesa, em quilos. `null` quando o boletim não declarou.
 *
 * Só reconhece o peso quando ele está no FIM do texto, seguido de `KG`: é assim
 * que a fonte escreve, e casar `KG` no meio da string aceitaria coisas como
 * "CX 20 KG BRUTO" — onde 20 kg é o peso da caixa cheia com a caixa, não do
 * produto. Preferir `null` a um número que parece certo é a escolha barata aqui.
 */
export function pesoEmKg(unit: string | null | undefined): Decimal | null {
  if (!unit) return null;
  const texto = unit.trim().toUpperCase();
  if (!texto) return null;

  // `KG` puro é a cotação por quilo: o peso é 1 por definição.
  if (texto === "KG") return new Decimal(1);

  const m = /(\d+(?:[.,]\d+)?)\s*KG$/.exec(texto);
  if (!m) return null;

  const peso = toDecimal(m[1].replace(",", "."));
  // Peso zero ou negativo é erro de digitação no boletim manual, não medida.
  // Deixar passar faria a divisão de `precoPorKg` devolver 0 — que a tela leria
  // como "de graça".
  if (peso.lessThanOrEqualTo(0)) return null;
  return peso;
}

/**
 * Quanto sai o quilo nesta embalagem. `null` quando não dá para saber.
 *
 * Não usa `div` de `money.ts` sem antes conferir o peso de propósito: aquele
 * helper devolve 0 em divisão por zero, e um R$ 0,00 aqui não leria como "não
 * sei" — leria como "está de graça".
 */
export function precoPorKg(
  refPrice: Numeric | null | undefined,
  unit: string | null | undefined,
): Decimal | null {
  if (refPrice === null || refPrice === undefined) return null;
  const peso = pesoEmKg(unit);
  if (!peso) return null;
  const preco = toDecimal(refPrice);
  if (preco.lessThanOrEqualTo(0)) return null;
  return money(preco.dividedBy(peso));
}

/**
 * Sinônimos de cada unidade de venda do cliente no vocabulário do boletim.
 *
 * `KG` fica de fora porque é o único caso de igualdade exata (ver `casa`): a
 * cotação por quilo é a linha `KG`, e um prefixo aceitaria qualquer coisa que
 * comece com essas duas letras.
 */
const SIGLAS: Record<Exclude<SaleUnit, "KG">, string[]> = {
  CAIXA: ["CX", "CAIXA"],
  SACO: ["SC", "SACO", "SACA"],
  BANDEJA: ["BAND", "BDJ", "BJ"],
  UNIDADE: ["UN"],
};

/**
 * A embalagem do boletim fala da mesma coisa que a unidade de venda do cliente?
 *
 * Serve às telas de operação decidirem se MOSTRAM a referência. Um "R$ 4,20/KG"
 * ao lado do campo de preço de um produto vendido por CAIXA é pior que espaço
 * vazio: o número está certo, a leitura é errada, e o operador digita em cima
 * dele no balcão.
 *
 * Deliberadamente conservadora — só a afinidade de texto que a fonte publica.
 * Nada de peso, nada de conversão: aqui a pergunta é "é a mesma unidade?", não
 * "quanto dá se eu converter".
 */
export function embalagemCasaComVenda(
  unit: string | null | undefined,
  saleUnit: SaleUnit,
): boolean {
  const texto = (unit ?? "").trim().toUpperCase();
  if (!texto) return false;
  if (saleUnit === "KG") return texto === "KG";
  return SIGLAS[saleUnit].some((s) => texto.startsWith(s));
}

function casa(unit: string, saleUnit: SaleUnit): boolean {
  return embalagemCasaComVenda(unit, saleUnit);
}

/**
 * Qual embalagem do boletim provavelmente interessa a quem vende nesta unidade.
 *
 * É palpite de PARTIDA, não decisão: o cliente confirma na tela de vínculo, e
 * errar aqui custa um toque. É por isso que a função pode ser generosa onde
 * `sugerirVinculos` (em `nome.ts`) tem de ser conservadora — lá o palpite grava
 * preço no lugar errado, aqui só pré-seleciona uma opção visível.
 *
 * A ordem de preferência, quando várias embalagens casam com a unidade de venda:
 *
 *  1. a que pesa exatamente o que o cadastro do produto diz (`dicaDePeso`, que
 *     vem de `Product.qtyPerRecipient`) — quem cadastrou "caixa de 20" e vê
 *     `CX 20 KG` no boletim está falando da mesma caixa;
 *  2. a que tem peso declarado, porque só ela rende R$/kg na tela;
 *  3. a primeira em ordem alfabética, para a sugestão não mudar entre duas
 *     aberturas da mesma tela.
 *
 * Sem nenhuma correspondência, cai em `KG` quando a praça publica por quilo:
 * quem vende caixa e só encontra o quilo no boletim continua tendo uma
 * referência útil. Devolve `null` quando nem isso existe — aí a escolha é
 * inteiramente do cliente.
 */
export function sugerirUnidade(
  saleUnit: SaleUnit,
  unidadesDisponiveis: string[],
  dicaDePeso?: Numeric | null,
): string | null {
  const candidatas = unidadesDisponiveis.filter((u) => casa(u, saleUnit));
  if (candidatas.length === 0) {
    return unidadesDisponiveis.find((u) => u.trim().toUpperCase() === "KG") ?? null;
  }

  const dica = dicaDePeso === null || dicaDePeso === undefined ? null : toDecimal(dicaDePeso);
  const ordenadas = [...candidatas].sort((a, b) => {
    const pa = pesoEmKg(a);
    const pb = pesoEmKg(b);
    if (dica && dica.greaterThan(0)) {
      const ca = pa?.equals(dica) ? 0 : 1;
      const cb = pb?.equals(dica) ? 0 : 1;
      if (ca !== cb) return ca - cb;
    }
    const ta = pa ? 0 : 1;
    const tb = pb ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return a.localeCompare(b, "pt-BR");
  });

  return ordenadas[0];
}

/**
 * Como a embalagem aparece na tela.
 *
 * Boletim manual pode vir sem embalagem (`unit` é `''`, e a coluna é NOT NULL de
 * propósito — ver o comentário de `CeasaQuote.unit` no schema). Mostrar a string
 * vazia deixaria um travessão solto depois do nome do produto; a frase diz o que
 * de fato aconteceu.
 */
export function rotuloDeEmbalagem(unit: string | null | undefined): string {
  const texto = (unit ?? "").trim();
  return texto || "sem embalagem informada";
}
