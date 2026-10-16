/**
 * Custo da carga informada no cadastro do produto (estoque inicial).
 *
 * O dono informa dois custos por unidade — o da mercadoria e o do
 * descarregamento — e o que vira custo médio do estoque é a SOMA dos dois: a
 * descarga é parte do que a caixa custou para estar no box.
 *
 * As contas são em centavos inteiros. Em ponto flutuante, 0,1 + 0,2 vira
 * 0,30000000000000004 e 3 × 1,10 vira 3,3000000000000003, e o resumo mostraria
 * um centavo diferente do que o servidor grava.
 */

export interface CustoDaCarga {
  /** Mercadoria + descarga, por unidade. `null` quando nenhum dos dois foi informado. */
  custoUnitario: number | null;
  totalMercadoria: number;
  totalDescarga: number;
  total: number;
}

const centavos = (v: number | null | undefined) => Math.round((v ?? 0) * 100);

export function calcularCustoDaCarga(
  quantidade: number | null | undefined,
  mercadoria: number | null | undefined,
  descarga: number | null | undefined,
): CustoDaCarga {
  const qtd = quantidade && quantidade > 0 ? quantidade : 0;
  const m = centavos(mercadoria);
  const d = centavos(descarga);
  return {
    custoUnitario: mercadoria == null && descarga == null ? null : (m + d) / 100,
    totalMercadoria: Math.round(qtd * m) / 100,
    totalDescarga: Math.round(qtd * d) / 100,
    total: (Math.round(qtd * m) + Math.round(qtd * d)) / 100,
  };
}

const NOMES: Record<string, [singular: string, plural: string]> = {
  CAIXA: ["caixa", "caixas"],
  KG: ["kg", "kg"],
  SACO: ["saco", "sacos"],
  BANDEJA: ["bandeja", "bandejas"],
  UNIDADE: ["unidade", "unidades"],
};

/** "caixa" / "caixas", "kg" — o nome da embalagem para frases do resumo. */
export function nomeDaEmbalagem(saleUnit: string, quantidade = 1): string {
  const [singular, plural] = NOMES[saleUnit] ?? ["unidade", "unidades"];
  return quantidade === 1 ? singular : plural;
}
