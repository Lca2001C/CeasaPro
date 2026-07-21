import { NextResponse, type NextRequest } from "next/server";
import { verifyAccess, ACCESS_COOKIE } from "@/lib/auth/jwt";
import { accessDecision } from "@/lib/billing/status";
import { moduleForPath, isModuleEnabled } from "@/lib/plan/modules";

// Rotas publicas (sem sessao).
const PUBLIC_PREFIXES = [
  "/login",
  "/recuperar-senha",
  "/offline", // fallback do PWA (o SW pré-cacheia; não pode redirecionar p/ login)
  "/api/auth",
  "/api/webhooks",
  "/api/cron",
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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  const session = token ? await verifyAccess(token) : null;

  // Raiz: manda para o lugar certo.
  if (pathname === "/") {
    if (!session) return NextResponse.redirect(new URL("/login", req.url));
    if (session.mustChangePassword) {
      return NextResponse.redirect(new URL(PASSWORD_CHANGE_PATH, req.url));
    }
    return NextResponse.redirect(new URL(homeFor(session.role), req.url));
  }

  // Ja logado tentando abrir /login -> vai para a home.
  if (session && (pathname === "/login" || pathname.startsWith("/login/"))) {
    const target = session.mustChangePassword ? PASSWORD_CHANGE_PATH : homeFor(session.role);
    return NextResponse.redirect(new URL(target, req.url));
  }

  if (isPublic(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api");

  if (!session) {
    if (isApi) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Nao autenticado" } },
        { status: 401 },
      );
    }
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Enquanto a senha nao for trocada, a UNICA area acessivel e a troca de senha
  // (+ logout/refresh). Vale para OWNER e SUPER_ADMIN, por isso o early-return ANTES
  // dos redirecionamentos por papel — senao /alterar-senha <-> /admin entram em loop
  // (ERR_TOO_MANY_REDIRECTS): o super-admin era mandado de volta para /admin e /admin
  // exigia a troca de senha de novo.
  if (session.mustChangePassword) {
    if (isPasswordChangeAllowed(pathname)) return NextResponse.next();
    if (isApi) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "PASSWORD_CHANGE_REQUIRED", message: "Troque sua senha para continuar." },
        },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL(PASSWORD_CHANGE_PATH, req.url));
  }

  // Area do super-admin.
  if (pathname.startsWith("/admin")) {
    if (session.role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL(homeFor(session.role), req.url));
    }
    return NextResponse.next();
  }

  // Daqui pra baixo e area da empresa (OWNER).
  if (session.role === "SUPER_ADMIN") {
    // super-admin nao usa a area da empresa
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  // Bloqueio por assinatura (exceto rotas de regularizacao).
  const billingSafe = BILLING_SAFE_PREFIXES.some((p) => pathname.startsWith(p));
  if (!billingSafe) {
    const decision = accessDecision(session.tenantStatus, session.subStatus);
    if (decision === "blocked") {
      if (isApi) {
        return NextResponse.json(
          { ok: false, error: { code: "PAYMENT_REQUIRED", message: "Assinatura inativa" } },
          { status: 402 },
        );
      }
      return NextResponse.redirect(new URL("/conta/suspensa", req.url));
    }
  }

  // Bloqueio por módulo do plano (recurso fora do plano contratado).
  const mod = moduleForPath(pathname);
  if (mod && !isModuleEnabled(session.modules, mod)) {
    if (isApi) {
      return NextResponse.json(
        { ok: false, error: { code: "FORBIDDEN", message: "Recurso não incluído no seu plano" } },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL(`/plano?bloqueado=${mod}`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Roda em tudo, menos TODOS os internos do Next (_next/*, incluindo o WebSocket do
  // HMR em dev — _next/webpack-hmr), assets estaticos e PWA (sw.js/manifest/icones).
  // Excluir só _next/static|_next/image deixava o proxy responder um redirect 307 ao
  // handshake do WebSocket do HMR → "WebSocket handshake: ERR_INVALID_HTTP_RESPONSE".
  matcher: ["/((?!_next/|favicon.ico|icons|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)"],
};
