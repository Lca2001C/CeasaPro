import Link from "next/link";
import { TERMS_UPDATED_AT } from "@/lib/legal";

/**
 * Layout das páginas públicas (documentos legais).
 * Sem sessão, sem navegação da aplicação: são páginas que precisam abrir para
 * qualquer pessoa, inclusive antes do login e a partir do checkout.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-secondary/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/login" className="text-lg font-bold text-primary">
            CeasaPro
          </Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:underline">
            Voltar ao login
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <article className="prose-sm flex flex-col gap-4 text-sm leading-relaxed">{children}</article>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>Última atualização: {TERMS_UPDATED_AT}</span>
          <span className="flex gap-3">
            <Link href="/termos" className="hover:underline">
              Termos de Uso
            </Link>
            <Link href="/privacidade" className="hover:underline">
              Política de Privacidade
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
