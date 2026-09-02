/**
 * Peças compartilhadas da renovação de sessão por navegação.
 *
 * Módulo próprio, e não dentro da rota, porque o **proxy** precisa da constante
 * do cookie — e o proxy roda no Edge. Importar a rota de lá arrastaria Prisma e
 * `next/headers` para o bundle do middleware, que não os suporta.
 *
 * Nada aqui toca banco, cookie ou rede: é só nome e regra pura, para poder ser
 * lido dos dois lados e testado sozinho.
 */

/**
 * Marca de "acabei de tentar renovar" (trava anti-laço).
 *
 * Se o cookie novo não for aceito na requisição seguinte — relógio fora de hora,
 * cookie descartado por política do navegador — o proxy veria de novo "sem
 * sessão + com refresh token" e mandaria para a renovação outra vez, sem fim.
 * Com esta marca, de vida curta, ele desiste e manda para o login: estado ruim,
 * mas finito.
 */
export const COOKIE_TENTATIVA_RENOVACAO = "cp_renov";

/** Validade da marca. Curta: só precisa cobrir o ida-e-volta do redirecionamento. */
export const TENTATIVA_MAX_AGE_SEGUNDOS = 30;

/**
 * Para onde voltar depois de renovar.
 *
 * Aceita SÓ caminho interno. `//outro.site` é URL protocolo-relativa e o
 * navegador a trataria como domínio externo: deixar passar transformaria a rota
 * de renovação em redirecionamento aberto — útil para phishing exibindo o nosso
 * domínio na barra de endereços.
 */
export function destinoSeguro(bruto: string | null | undefined): string {
  if (!bruto) return "/";
  if (!bruto.startsWith("/")) return "/";
  // `//host` e `/\host`: alguns navegadores normalizam a segunda para a primeira.
  if (bruto.startsWith("//") || bruto.startsWith("/\\")) return "/";
  return bruto;
}
