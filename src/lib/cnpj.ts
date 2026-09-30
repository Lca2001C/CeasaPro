/**
 * CNPJ: só dígitos, e com dígito verificador conferido.
 *
 * Guardar o texto como digitado fazia `12.345.678/0001-90` e `12345678000190`
 * passarem pela unicidade como empresas diferentes, e um dígito trocado só
 * aparecia quando o Mercado Pago recusava o PIX da mensalidade com uma
 * mensagem que não aponta o CNPJ. Funções puras (sem Prisma), para o schema
 * Zod usá-las no cliente e no servidor.
 */

/** Tira pontuação e espaços. Não valida. */
export function normalizarCnpj(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** 14 dígitos, não todos iguais, com os dois dígitos verificadores certos. */
export function cnpjValido(valor: string): boolean {
  const d = normalizarCnpj(valor);
  if (d.length !== 14) return false;
  // 00000000000000, 11111111111111… passam na conta e não existem.
  if (/^(\d)\1{13}$/.test(d)) return false;
  const digitos = d.split("").map(Number);
  const dv = (n: number) => {
    // Pesos 5..2,9..2 para o 1º DV (12 dígitos) e 6..2,9..2 para o 2º (13).
    let peso = n - 7;
    let soma = 0;
    for (let i = 0; i < n; i++) {
      soma += digitos[i] * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(12) === digitos[12] && dv(13) === digitos[13];
}
