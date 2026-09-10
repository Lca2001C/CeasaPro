import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * 404 para o que está FORA da área logada.
 *
 * O `(app)/not-found.tsx` cobre a área da empresa e vem com o AppShell. Este
 * cobre o resto: link velho na landing, caminho digitado errado, URL antiga
 * compartilhada por WhatsApp. Aqui não há menu para oferecer — quem chega pode
 * nem ter conta — então as duas saídas são a landing e o login.
 *
 * Sem `export const dynamic`, e é de propósito: esta página não lê sessão nem
 * cabeçalho, e a regra de `force-dynamic` do projeto existe para páginas
 * públicas que precisam do nonce da CSP (ver `src/proxy.ts`). Esta não injeta
 * script nenhum.
 */
export default function NaoEncontrado() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <SearchX className="size-12 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="text-2xl font-bold text-primary">CeasaPro</p>
        <h1 className="mt-4 text-lg font-semibold">Esta página não existe</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          O endereço pode estar errado ou a página pode ter saído do ar.
        </p>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Ir para o início
        </Link>
        <Link
          href="/login"
          className="rounded-lg border px-5 py-2.5 text-sm font-semibold hover:bg-accent"
        >
          Entrar
        </Link>
      </div>
    </main>
  );
}
