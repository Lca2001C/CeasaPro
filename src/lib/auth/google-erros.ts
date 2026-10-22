/**
 * Códigos e mensagens de erro do login com Google — SEM dependência nenhuma.
 *
 * Mora fora de `google-oauth.ts` porque o botão da tela de login (componente de
 * cliente) precisa das mensagens, e importá-las de lá arrastava para o
 * navegador `node:crypto` (como `crypto-browserify`), `jose` e as chaves:
 * ~130 KB gzip só no login e no cadastro. `google-oauth.ts` agora é
 * `server-only` e reexporta daqui.
 */

export type GoogleLoginErro =
  | "google-indisponivel"
  | "google-cancelado"
  | "google-falhou"
  | "google-inativo"
  | "google-outra-conta"
  | "google-muitas-tentativas";

export const MENSAGENS_ERRO_GOOGLE: Record<GoogleLoginErro, string> = {
  "google-indisponivel":
    "Entrar com Google ainda não está disponível. Use e-mail e senha.",
  "google-cancelado": "Entrada com Google cancelada.",
  "google-falhou":
    "Não foi possível entrar com o Google. Tente de novo ou use e-mail e senha.",
  // O Google já comprovou a identidade: ser específico aqui não revela conta a
  // ninguém além do dono, e "tente de novo" o mandava repetir o mesmo erro.
  "google-inativo": "Esta conta está desativada. Fale com o suporte do CeasaPro.",
  "google-outra-conta":
    "Este e-mail já está ligado a outra conta do Google. Entre com ela ou com e-mail e senha.",
  "google-muitas-tentativas":
    "Muitas tentativas de entrar com o Google nesta rede. Aguarde alguns minutos e tente de novo.",
};
