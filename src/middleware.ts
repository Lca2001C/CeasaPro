import { NextResponse, type NextRequest } from "next/server";
import { verifyAccess, ACCESS_COOKIE } from "@/lib/auth/jwt";
import { accessDecision } from "@/lib/billing/status";

// Rotas públicas (sem sessão).
const PUBLIC_PREFIXES = [
  "/login",
  "/recuperar-senha",
  "/api/auth",
  "/api/webhooks",
  "/api/cron",
];

// Rotas sempre acessíveis mesmo com assinatura bloqueada.
const BILLING_SAFE_PREFIXES = ["/conta", "/assinatura", "/api/billing", "/api/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
}

function homeFor(role: string) {
  return role === "SUPER_ADMIN" ? "/admin" : "/dashboard";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  const session = token ? await verifyAccess(token) : null;

  // Raiz: manda para o lugar certo.
  if (pathname === "/") {
    if (!session) return NextResponse.redirect(new URL("/login", req.url));
    return NextResponse.redirect(new URL(homeFor(session.role), req.url));
  }

  // Já logado tentando abrir /login → vai para a home.
  if (session && (pathname === "/login" || pathname.startsWith("/login/"))) {
    return NextResponse.redirect(new URL(homeFor(session.role), req.url));
  }

  if (isPublic(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api");

  if (!session) {
    if (isApi) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Não autenticado" } },
        { status: 401 },
      );
    }
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Área do super-admin.
  if (pathname.startsWith("/admin")) {
    if (session.role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL(homeFor(session.role), req.url));
    }
    return NextResponse.next();
  }

  // Daqui pra baixo é área da empresa (OWNER).
  if (session.role === "SUPER_ADMIN") {
    // super-admin não usa a área da empresa
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  // Bloqueio por assinatura (exceto rotas de regularização).
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
  // Roda em tudo, menos assets estáticos e internos do Next.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)"],
};
