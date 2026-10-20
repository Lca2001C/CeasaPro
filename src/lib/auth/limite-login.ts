/**
 * Chave do limite de login POR E-MAIL (`rate_limits`), num lugar só: o login a
 * incrementa, e a redefinição de senha a zera — quem provou ser dono da caixa
 * de e-mail não pode continuar trancado por tentativas de outra pessoa.
 */
export function chaveDeLoginPorEmail(email: string): string {
  return `login:email:${email.trim().toLowerCase()}`;
}
