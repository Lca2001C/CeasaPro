/**
 * Aritmética da venda — a MESMA função no navegador e no servidor.
 *
 * Antes existiam três contas diferentes para o mesmo total:
 *  - o PDV arredondava a soma UMA vez, em ponto flutuante
 *    (`Math.round(v * 100) / 100`);
 *  - o serviço arredondava LINHA A LINHA, em `Prisma.Decimal`;
 *  - o refine do Zod conferia as parcelas contra um total calculado como o do
 *    PDV, e por isso nunca enxergava a divergência.
 *
 * Com dois itens de `1,115 × R$ 1,00` a tela mostrava R$ 2,23 e o banco
 * gravava R$ 2,24 — e, em pagamento misto, as parcelas somavam 2,23 contra um
 * `totalAmount` de 2,24: `sale_payments` deixava de fechar com
 * `sales.totalAmount`, sem nada reconferir.
 *
 * A correção não é "o cliente imita o servidor": os dois executam literalmente
 * esta função. Por isso o módulo é PURO, sem nenhum import. Ele não pode
 * depender de `@/lib/money`, que traz `Prisma` de `@prisma/client` — o serviço
 * converte para `Decimal` só na borda, na hora de gravar.
 *
 * Tudo em `BigInt` com escala inteira, nunca em `number`: quantidade de até 1e6
 * vezes preço de até 1e6 dá 1e17, acima de `Number.MAX_SAFE_INTEGER`.
 */

/** Casas da quantidade — a mesma do banco (`Decimal(14,3)`). */
export const ESCALA_QUANTIDADE = 3;
/** Casas do dinheiro — a mesma do banco (`Decimal(14,2)`). */
export const ESCALA_DINHEIRO = 2;

/**
 * Normaliza para notação decimal simples, resolvendo o expoente.
 *
 * `String(0.0000001)` devolve "1e-7"; sem isto o parser leria 1.
 */
function paraDecimalSimples(valor: number | string): string {
  const texto = typeof valor === "string" ? valor.trim() : String(valor);
  const partes = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(texto);
  if (!partes || (partes[2] === "" && (partes[3] ?? "") === "")) {
    throw new Error(`Valor numerico invalido: ${texto}`);
  }
  const sinal = partes[1] === "-" ? "-" : "";
  let inteiro = partes[2] || "0";
  let fracao = partes[3] || "";
  const expoente = partes[4] ? Number(partes[4]) : 0;

  if (expoente > 0) {
    const move = Math.min(expoente, fracao.length);
    inteiro += fracao.slice(0, move) + "0".repeat(expoente - move);
    fracao = fracao.slice(move);
  } else if (expoente < 0) {
    const casas = -expoente;
    const move = Math.min(casas, inteiro.length);
    fracao = "0".repeat(casas - move) + inteiro.slice(inteiro.length - move) + fracao;
    inteiro = inteiro.slice(0, inteiro.length - move) || "0";
  }
  return `${sinal}${inteiro || "0"}${fracao ? `.${fracao}` : ""}`;
}

/** Código do dígito 5, para o corte do arredondamento meio-para-cima. */
const CODIGO_CINCO = 53;

/**
 * Converte para inteiro na escala pedida, arredondando meio-para-cima.
 *
 * Lê de `String(v)` — a representação decimal MAIS CURTA — e nunca de
 * `toFixed`. A diferença não é cosmética: `String(1.005)` é "1.005" e arredonda
 * para 1,01, enquanto `(1.005).toFixed(2)` lê o binário exato (1,00499…) e
 * devolve "1.00". O `Prisma.Decimal` constrói a partir da repr curta, então é
 * ela que reproduz a semântica do servidor.
 */
export function paraEscala(valor: number | string, escala: number): bigint {
  const simples = paraDecimalSimples(valor);
  const negativo = simples.startsWith("-");
  const semSinal = negativo ? simples.slice(1) : simples;
  const [inteiro = "0", fracao = ""] = semSinal.split(".");

  const completada = (fracao + "0".repeat(escala)).slice(0, escala);
  let escalado = BigInt(inteiro + completada);
  // Meio-para-cima sobre o primeiro dígito descartado, afastando do zero —
  // que é o padrão do decimal.js usado pelo Prisma.
  if (fracao.length > escala && fracao.charCodeAt(escala) >= CODIGO_CINCO) {
    escalado += 1n;
  }
  return negativo ? -escalado : escalado;
}

/** Reais para centavos. */
export function paraCentavos(valor: number | string): bigint {
  return paraEscala(valor, ESCALA_DINHEIRO);
}

/** Quantidade para milésimos. */
export function paraMilesimos(valor: number | string): bigint {
  return paraEscala(valor, ESCALA_QUANTIDADE);
}

/** Divisão inteira com arredondamento meio-para-cima, afastando do zero. */
function dividirMeioAcima(numerador: bigint, denominador: bigint): bigint {
  const negativo = numerador < 0n;
  const absoluto = negativo ? -numerador : numerador;
  const quociente = absoluto / denominador;
  const resto = absoluto % denominador;
  const ajustado = resto * 2n >= denominador ? quociente + 1n : quociente;
  return negativo ? -ajustado : ajustado;
}

/**
 * Decimal exato: `valor / 10^escala`, sem perder nenhum dígito.
 *
 * Existe porque arredondar as ENTRADAS antes de multiplicar dá resultado
 * diferente de arredondar o PRODUTO — e é o produto que o servidor arredonda.
 * Com `7 × 0,105`, cortar o preço para R$ 0,11 primeiro daria R$ 0,77; o
 * `Prisma.Decimal` multiplica em precisão cheia (0,735) e arredonda uma vez só,
 * dando R$ 0,74. O banco tem o segundo valor.
 */
interface DecimalExato {
  valor: bigint;
  escala: number;
}

/** Lê um número preservando TODAS as casas — nunca arredonda. */
function exato(valor: number | string): DecimalExato {
  const simples = paraDecimalSimples(valor);
  const negativo = simples.startsWith("-");
  const semSinal = negativo ? simples.slice(1) : simples;
  const [inteiro = "0", fracao = ""] = semSinal.split(".");
  const bruto = BigInt((inteiro || "0") + fracao);
  return { valor: negativo ? -bruto : bruto, escala: fracao.length };
}

/** Traz dois decimais exatos para a mesma escala, sem perder precisão. */
function alinhar(a: DecimalExato, b: DecimalExato): { a: bigint; b: bigint; escala: number } {
  const escala = Math.max(a.escala, b.escala);
  return {
    a: a.valor * 10n ** BigInt(escala - a.escala),
    b: b.valor * 10n ** BigInt(escala - b.escala),
    escala,
  };
}

function somarExato(a: DecimalExato, b: DecimalExato): DecimalExato {
  const { a: x, b: y, escala } = alinhar(a, b);
  return { valor: x + y, escala };
}

function subtrairExato(a: DecimalExato, b: DecimalExato): DecimalExato {
  const { a: x, b: y, escala } = alinhar(a, b);
  return { valor: x - y, escala };
}

/** Multiplicação exata: as escalas se somam, nada é descartado. */
function multiplicarExato(a: DecimalExato, b: DecimalExato): DecimalExato {
  return { valor: a.valor * b.valor, escala: a.escala + b.escala };
}

/** Arredonda um decimal exato para centavos, meio-para-cima. */
function paraCentavosExato(d: DecimalExato): bigint {
  if (d.escala <= ESCALA_DINHEIRO) {
    return d.valor * 10n ** BigInt(ESCALA_DINHEIRO - d.escala);
  }
  return dividirMeioAcima(d.valor, 10n ** BigInt(d.escala - ESCALA_DINHEIRO));
}

const ZERO_EXATO: DecimalExato = { valor: 0n, escala: 0 };

export interface ItemDaVenda {
  quantity: number;
  unitPrice: number;
  discountAmount?: number | null;
}

export interface VendaParaTotal {
  items: readonly ItemDaVenda[];
  discountAmount?: number | null;
}

export interface TotaisDaVenda {
  /** Bruto de cada linha, em centavos, ANTES do desconto dela. */
  brutosCents: bigint[];
  /** Cada linha já líquida do desconto dela, em centavos. */
  lineTotalsCents: bigint[];
  /** Soma dos brutos — o que a mercadoria valia. */
  subtotalCents: bigint;
  /** Desconto aplicado sobre o total da venda. */
  descontoVendaCents: bigint;
  /** O que o cliente paga. Nunca negativo. */
  totalCents: bigint;
}

/**
 * O cálculo canônico da venda. A ordem que vale é a do servidor:
 *
 *  1. bruto da linha = quantidade × preço, em precisão cheia;
 *  2. linha líquida  = arredonda2(bruto − desconto da linha);
 *  3. subtotal       = arredonda2(soma dos brutos);
 *  4. total          = soma das linhas líquidas − desconto da venda.
 *
 * Arredondar por linha e só então somar (e não o contrário) é o que já está
 * gravado no banco; inverter isso reescreveria o histórico de toda venda.
 */
export function calcularTotaisVenda(venda: VendaParaTotal): TotaisDaVenda {
  let somaBruto = ZERO_EXATO;
  const brutosCents: bigint[] = [];
  const lineTotalsCents: bigint[] = [];

  for (const item of venda.items) {
    const bruto = multiplicarExato(exato(item.quantity), exato(item.unitPrice));
    somaBruto = somarExato(somaBruto, bruto);
    brutosCents.push(paraCentavosExato(bruto));

    const liquida = subtrairExato(bruto, exato(item.discountAmount ?? 0));
    lineTotalsCents.push(paraCentavosExato(liquida));
  }

  // O desconto da venda incide sobre a soma das linhas JÁ arredondadas — é
  // assim que o serviço grava, e é o que a tela de detalhe reexibe.
  const somaLinhas: DecimalExato = {
    valor: lineTotalsCents.reduce((total, linha) => total + linha, 0n),
    escala: ESCALA_DINHEIRO,
  };
  const descontoVenda = exato(venda.discountAmount ?? 0);
  const totalCents = paraCentavosExato(subtrairExato(somaLinhas, descontoVenda));

  return {
    brutosCents,
    lineTotalsCents,
    subtotalCents: paraCentavosExato(somaBruto),
    descontoVendaCents: paraCentavosExato(descontoVenda),
    totalCents: totalCents < 0n ? 0n : totalCents,
  };
}

/** Total cobrado, em centavos. Atalho de {@link calcularTotaisVenda}. */
export function totalDaVendaCents(venda: VendaParaTotal): bigint {
  return calcularTotaisVenda(venda).totalCents;
}

export interface ParcelaDePagamento {
  method: string;
  amount: number;
}

/** Soma das formas de pagamento, em centavos. */
export function somaParcelasCents(
  parcelas: readonly ParcelaDePagamento[] | null | undefined,
): bigint {
  if (!parcelas || parcelas.length === 0) return 0n;
  // Soma em precisão cheia e arredonda UMA vez, como `money(add(...))` faz no
  // servidor — arredondar parcela a parcela deslocaria a soma em centavos.
  const soma = parcelas.reduce(
    (total, p) => somarExato(total, exato(p.amount)),
    ZERO_EXATO,
  );
  return paraCentavosExato(soma);
}

/**
 * Quanto desta venda foi pago EM ESPÉCIE, em centavos.
 *
 * É contra este valor — e não contra o total — que o troco tem de ser
 * calculado. Numa venda de R$ 100 paga com R$ 60 em PIX e R$ 40 em dinheiro, o
 * cliente que entrega R$ 50 recebe R$ 10 de troco, não zero. Numa venda de
 * forma única em dinheiro os dois coincidem, e é por isso que o comportamento
 * antigo continua valendo onde sempre esteve certo.
 */
export function parteEmDinheiroCents(venda: {
  paymentMethod?: string | null;
  payments?: readonly ParcelaDePagamento[] | null;
  items: readonly ItemDaVenda[];
  discountAmount?: number | null;
}): bigint {
  if (venda.payments && venda.payments.length > 0) {
    return somaParcelasCents(venda.payments.filter((p) => p.method === "DINHEIRO"));
  }
  return venda.paymentMethod === "DINHEIRO" ? totalDaVendaCents(venda) : 0n;
}

/** Centavos para string decimal (`4200n` vira "42.00"), pronta para o `Decimal`. */
export function centsParaString(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = (negativo ? -centavos : centavos)
    .toString()
    .padStart(ESCALA_DINHEIRO + 1, "0");
  const corte = absoluto.length - ESCALA_DINHEIRO;
  return `${negativo ? "-" : ""}${absoluto.slice(0, corte)}.${absoluto.slice(corte)}`;
}

/** Centavos para number. Só para exibir e para o corpo JSON — nunca para calcular. */
export function centsParaNumero(centavos: bigint): number {
  return Number(centsParaString(centavos));
}
