/**
 * Dinheiro tem 2 casas. Valor com mais casas era aceito e arredondado ao
 * gravar: R$ 0,125 × 100 caixas gravava o total R$ 12,50 com o preço de R$ 0,13
 * na tela (100 × 0,13 = 13,00), e um pagamento de R$ 0,004 virava uma linha de
 * R$ 0,00 no extrato.
 */
export function temAteDuasCasas(v: number): boolean {
  return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
}

export const MSG_DUAS_CASAS = "Use no máximo 2 casas decimais";
