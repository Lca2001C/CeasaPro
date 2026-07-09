import { NextResponse, type NextRequest } from "next/server";
import { verifyAccess, ACCESS_COOKIE } from "@/lib/auth/jwt";
import { accessDecision } from "@/lib/billing/status";

// Rotas publicas (sem sessao).
const PUBLIC_PREFIXES = [
  "/login",
  "/recuperar-senha",
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

  if (session.mustChangePassword && !isPasswordChangeAllowed(pathname)) {
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

  return NextResponse.next();
}

export const config = {
  // Roda em tudo, menos assets estaticos, PWA (sw.js/manifest/icones) e internos do Next.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)"],
};
