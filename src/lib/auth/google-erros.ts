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
  | "google-inativo";

export const MENSAGENS_ERRO_GOOGLE: Record<GoogleLoginErro, string> = {
  "google-indisponivel":
    "Entrar com Google ainda não está disponível. Use e-mail e senha.",
  "google-cancelado": "Entrada com Google cancelada.",
  "google-falhou":
    "Não foi possível entrar com o Google. Tente de novo ou use e-mail e senha.",
  "google-inativo":
    "Não foi possível entrar com o Google. Tente de novo ou use e-mail e senha.",
};
