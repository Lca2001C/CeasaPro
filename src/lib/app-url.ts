/**
 * URL pública da aplicação — origem única para links absolutos (e-mail de
 * recuperação de senha, back_urls/notification_url do Mercado Pago, etc).
 *
 * Ordem de precedência:
 *   1. APP_URL                    — o que você configurou explicitamente (vence sempre)
 *   2. NEXT_PUBLIC_APP_URL        — mesmo valor, exposto ao browser
 *   3. RENDER_EXTERNAL_URL        — injetada pelo Render (https://<serviço>.onrender.com)
 *   4. RENDER_EXTERNAL_HOSTNAME   — idem, só o host (recebe https:// aqui)
 *   5. http://localhost:3000      — dev
 *
 * Os itens 3 e 4 são a rede de segurança do deploy no Render: se APP_URL não
 * for preenchida no Blueprint, o link de redefinição de senha ainda sai com o
 * domínio certo em vez de apontar para localhost (e-mail inútil).
 * Atenção: só existem em runtime, nunca no build.
 */

const FALLBACK = "http://localhost:3000";

/** Resolvida a cada chamada: em runtime as variáveis do Render já estão no ambiente. */
function configured(): string | null {
  const candidates = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.RENDER_EXTERNAL_HOSTNAME,
  ];
  for (const candidate of candidates) {
    const url = normalize(candidate);
    if (url) return url;
  }
  return null;
}

export function appBaseUrl(): string {
  return configured() ?? FALLBACK;
}

/** Monta uma URL absoluta a partir de um caminho ("/recuperar-senha/abc"). */
export function absoluteUrl(path: string): string {
  return `${appBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * True quando a URL pública veio de variável de ambiente (e não do fallback
 * localhost). Em produção, links de e-mail com localhost são inúteis — as
 * rotas usam isto para registrar um erro claro no log.
 */
export function hasConfiguredAppUrl(): boolean {
  // Olha as variáveis, não o valor resolvido: APP_URL="http://localhost:3000"
  // em dev é uma configuração legítima, não a ausência de configuração.
  return configured() !== null;
}

/** Normaliza: apara espaços, remove barras finais e completa o esquema. */
function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  // RENDER_EXTERNAL_HOSTNAME vem sem esquema; https é o único válido no Render.
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
