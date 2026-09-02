/**
 * "Quem está usando o sistema agora."
 *
 * Na web isso nunca é exato — não existe evento de "fechou o app" — então o que
 * importa é escolher um sinal honesto e dizer qual é. O sinal aqui é a **sessão
 * viva renovada há pouco**: um `RefreshToken` não revogado, não expirado e criado
 * dentro da janela abaixo.
 *
 * Por que este e não outros dois candidatos óbvios:
 *
 * - **`User.lastLoginAt`** continuaria marcando presente quem já saiu: o logout
 *   não mexe nessa coluna. Alguém que entrou e saiu apareceria "online" pelo
 *   resto da janela, o que é exatamente a informação errada numa tela de
 *   acompanhamento.
 * - **Ter refresh token válido** (sem olhar a data de criação) marcaria presente
 *   qualquer um que tenha entrado nos últimos 30 dias, que é o prazo do token.
 *
 * O refresh token ROTACIONA (`rotateRefreshToken` revoga o antigo e cria um
 * novo), então a data de criação do token vivo mais recente é a última vez que a
 * sessão foi renovada. E as duas operações que deveriam derrubar a presença
 * revogam o token: `revokeRefreshToken` no logout e `revokeAllForUser` ao
 * desativar a conta. A presença cai junto, sem código extra.
 */

/**
 * Tamanho da janela.
 *
 * Casado com o `ACCESS_TOKEN_TTL` de 15 minutos, com folga: a sessão é renovada
 * ao menos uma vez a cada 15 minutos de uso, então 20 evita que alguém em uso
 * contínuo pisque para "offline" entre duas renovações. Em troca, quem fecha o
 * navegador sem sair continua aparecendo por até 20 minutos — o erro aceitável,
 * porque o inverso (some quem está trabalhando) tornaria a tela inútil.
 */
export const JANELA_ONLINE_MINUTOS = 20;

/**
 * Instante a partir do qual uma sessão renovada conta como presente.
 *
 * Separado da consulta para ser testável e para não haver duas contas de tempo
 * divergindo (a da tela e a do banco).
 */
export function inicioDaJanelaOnline(now: Date = new Date()): Date {
  return new Date(now.getTime() - JANELA_ONLINE_MINUTOS * 60 * 1000);
}
