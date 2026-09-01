import { NextResponse, type NextRequest } from "next/server";
import { verifyAccess, ACCESS_COOKIE } from "@/lib/auth/jwt";
import { accessDecision } from "@/lib/billing/status";
import { moduleForPath, isModuleEnabled } from "@/lib/plan/modules";

// Rotas publicas (sem sessao).
const PUBLIC_PREFIXES = [
  "/login",
  "/cadastro", // cadastro público + confirmação de e-mail (inicia o teste grátis)
  "/recuperar-senha",
  "/offline", // fallback do PWA (o SW pré-cacheia; não pode redirecionar p/ login)
  // Consulta dos dados salvos no aparelho. Publica pelo mesmo motivo do /offline,
  // com um a mais: sem rede o access token pode ter expirado, e redirecionar para
  // /login deixaria a pessoa sem acesso ao que ela JA tem no celular. O que
  // protege esses dados e o `limparSnapshotNoLogout` (nada fica apos sair).
  "/consulta-offline",
  // Documentos legais: precisam abrir sem sessão (são linkados no checkout e no login).
  "/termos",
  "/privacidade",
  "/api/auth",
  "/api/webhooks",
  "/api/cron",
  "/api/health",
];

// Rotas sempre acessiveis mesmo com assinatura bloqueada.
const BILLING_SAFE_PREFIXES = ["/conta", "/assinatura", "/api/billing", "/api/auth"];

const PASSWORD_CHANGE_PATH = "/alterar-senha";
const PASSWORD_CHANGE_API = "/api/auth/change-password";

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isPasswordChangeAllowed(pathname: string) {
  return (
    pathname === PASSWORD_CHANGE_PATH ||
    pathname.startsWith(PASSWORD_CHANGE_API) ||
    pathname.startsWith("/api/auth/logout") ||
    pathname.startsWith("/api/auth/refresh")
  );
}

function homeFor(role: string) {
  return role === "SUPER_ADMIN" ? "/admin" : "/dashboard";
}

/**
 * Content-Security-Policy com nonce por requisição.
 *
 * O nonce vai no cabeçalho da RESPOSTA e também no da REQUISIÇÃO: o Next lê o
 * `Content-Security-Policy` da requisição durante o SSR, extrai o `nonce-…` e o
 * aplica sozinho nos scripts do framework, nos bundles da página e nos estilos
 * que ele mesmo injeta. Por isso as páginas precisam ser renderizadas por
 * requisição — HTML pré-renderizado em build não tem nonce, e com
 * `'strict-dynamic'` (que faz o navegador IGNORAR o `'self'` em script-src) os
 * scripts sem nonce seriam bloqueados. As páginas que eram estáticas (`/login`,
 * `/termos`, `/privacidade`, `/recuperar-senha`, `/offline`) foram marcadas com
 * `force-dynamic` exatamente por isso.
 *
 * Onde a política é deliberadamente FROUXA, e por quê:
 *
 * - `form-action` e `frame-src` aceitam qualquer `https:`. O desafio 3-D Secure
 *   do cartão de débito faz um POST de formulário e abre um iframe para a URL do
 *   BANCO EMISSOR (ver `components/billing/three-ds-challenge.tsx`), que é um
 *   domínio arbitrário e desconhecido em build. `form-action 'self'` — o valor
 *   sugerido pela documentação do Next — bloquearia a autenticação e derrubaria
 *   o pagamento em débito em produção.
 * - `style-src` aceita `'unsafe-inline'`: Radix UI e Sonner posicionam elementos
 *   por atributo `style`, que o CSP bloqueia sem isso. Estilo inline não executa
 *   código — o ganho de segurança do nonce está em `script-src`, que segue estrito.
 * - `upgrade-insecure-requests` só entra em HTTPS: ligá-lo numa origem HTTP (o
 *   modo de teste na LAN por IP) faria o navegador tentar HTTPS nos próprios
 *   assets e quebrar a página.
 *
 * `CSP_REPORT_ONLY=1` publica a política sem aplicá-la — útil para observar
 * violações antes de endurecer alguma diretiva.
 */
function buildCsp(nonce: string, isHttps: boolean): string {
  const isDev = process.env.NODE_ENV === "development";
  const mp = "https://*.mercadopago.com https://*.mercadolibre.com https://*.mlstatic.com";

  return [
    `default-src 'self'`,
    // 'unsafe-eval' só em dev: o React usa eval para reconstruir stack de erro.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${mp}${isDev ? " ws: wss:" : ""}`,
    // 3DS abre o desafio do banco emissor: domínio arbitrário.
    `frame-src 'self' ${mp} https:`,
    `form-action 'self' https:`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

const CSP_HEADER = process.env.CSP_REPORT_ONLY === "1"
  ? "Content-Security-Policy-Report-Only"
  : "Content-Security-Policy";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const protoCadeia = (req.headers.get("x-forwarded-proto") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isHttps = protoCadeia[protoCadeia.length - 1] === "https";
  const csp = buildCsp(nonce, isHttps);

  /** Stampa a política em qualquer resposta que o proxy devolva. */
  function comCsp<T extends Response>(res: T): T {
    res.headers.set(CSP_HEADER, csp);
    return res;
  }

  /**
   * Segue para a rota. O nonce precisa ir nos headers da REQUISIÇÃO para o Next
   * conseguir aplicá-lo no HTML renderizado.
   */
  function seguir() {
    const headersDaRequisicao = new Headers(req.headers);
    headersDaRequisicao.set("x-nonce", nonce);
    headersDaRequisicao.set("Content-Security-Policy", csp);
    return comCsp(NextResponse.next({ request: { headers: headersDaRequisicao } }));
  }

  const redirecionar = (destino: string) =>
    comCsp(NextResponse.redirect(new URL(destino, req.url)));

  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  const session = token ? await verifyAccess(token) : null;

  // Raiz: quem não tem sessão vê a landing page (aquisição); quem já usa o
  // sistema vai direto para o seu lugar, como antes.
  if (pathname === "/") {
    if (!session) return seguir();
    if (session.mustChangePassword) {
      return redirecionar(PASSWORD_CHANGE_PATH);
    }
    return redirecionar(homeFor(session.role));
  }

  // Já logado tentando abrir o cadastro -> não faz sentido criar outra empresa.
  if (session && (pathname === "/cadastro" || pathname.startsWith("/cadastro/"))) {
    // Exceção: a confirmação de e-mail precisa funcionar mesmo com sessão ativa
    // (a pessoa se cadastrou e clicou no link já estando logada em outra conta,
    // ou abriu o link no mesmo navegador). Bloquear aqui deixaria o teste
    // pendente para sempre.
    if (!pathname.startsWith("/cadastro/confirmar/")) {
      const target = session.mustChangePassword ? PASSWORD_CHANGE_PATH : homeFor(session.role);
      return redirecionar(target);
    }
  }

  // Ja logado tentando abrir /login -> vai para a home.
  if (session && (pathname === "/login" || pathname.startsWith("/login/"))) {
    const target = session.mustChangePassword ? PASSWORD_CHANGE_PATH : homeFor(session.role);
    return redirecionar(target);
  }

  if (isPublic(pathname)) return seguir();

  const isApi = pathname.startsWith("/api");

  if (!session) {
    if (isApi) {
      return comCsp(
        NextResponse.json(
          { ok: false, error: { code: "UNAUTHORIZED", message: "Nao autenticado" } },
          { status: 401 },
        ),
      );
    }
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return comCsp(NextResponse.redirect(url));
  }

  // Enquanto a senha nao for trocada, a UNICA area acessivel e a troca de senha
  // (+ logout/refresh). Vale para OWNER e SUPER_ADMIN, por isso o early-return ANTES
  // dos redirecionamentos por papel — senao /alterar-senha <-> /admin entram em loop
  // (ERR_TOO_MANY_REDIRECTS): o super-admin era mandado de volta para /admin e /admin
  // exigia a troca de senha de novo.
  if (session.mustChangePassword) {
    if (isPasswordChangeAllowed(pathname)) return seguir();
    if (isApi) {
      return comCsp(
        NextResponse.json(
          {
            ok: false,
            error: { code: "PASSWORD_CHANGE_REQUIRED", message: "Troque sua senha para continuar." },
          },
          { status: 403 },
        ),
      );
    }
    return redirecionar(PASSWORD_CHANGE_PATH);
  }

  // Area do super-admin.
  if (pathname.startsWith("/admin")) {
    if (session.role !== "SUPER_ADMIN") {
      return redirecionar(homeFor(session.role));
    }
    return seguir();
  }

  // Daqui pra baixo e area da empresa.
  // O super-admin entra AQUI so quando tem ambiente proprio provisionado
  // (tenantId na sessao). Sem ambiente, volta para a gestao do sistema.
  if (session.role === "SUPER_ADMIN" && !session.tenantId) {
    return redirecionar("/admin");
  }

  // Bloqueio por assinatura (exceto rotas de regularizacao).
  const billingSafe = BILLING_SAFE_PREFIXES.some((p) => pathname.startsWith(p));
  if (!billingSafe) {
    const decision = accessDecision(session.tenantStatus, session.subStatus);
    if (decision === "blocked") {
      if (isApi) {
        return comCsp(
          NextResponse.json(
            { ok: false, error: { code: "PAYMENT_REQUIRED", message: "Assinatura inativa" } },
            { status: 402 },
          ),
        );
      }
      return redirecionar("/conta/suspensa");
    }
  }

  // Bloqueio por módulo do plano (recurso fora do plano contratado).
  const mod = moduleForPath(pathname);
  if (mod && !isModuleEnabled(session.modules, mod)) {
    if (isApi) {
      return comCsp(
        NextResponse.json(
          { ok: false, error: { code: "FORBIDDEN", message: "Recurso não incluído no seu plano" } },
          { status: 403 },
        ),
      );
    }
    return redirecionar(`/plano?bloqueado=${mod}`);
  }

  return seguir();
}

export const config = {
  // Roda em tudo, menos TODOS os internos do Next (_next/*, incluindo o WebSocket do
  // HMR em dev — _next/webpack-hmr), assets estaticos e PWA (sw.js/manifest/icones).
  // Excluir só _next/static|_next/image deixava o proxy responder um redirect 307 ao
  // handshake do WebSocket do HMR → "WebSocket handshake: ERR_INVALID_HTTP_RESPONSE".
  matcher: ["/((?!_next/|favicon.ico|icons|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)"],
};
