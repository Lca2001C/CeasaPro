import Link from "next/link";
import { Sprout } from "lucide-react";
import { IconeRedondo } from "@/components/ui/icone-redondo";

const linkDoRodape =
  "inline-flex min-h-11 items-center rounded-full px-3 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Fundo da página com um véu verde leve no topo: a entrada do app tem a cor
    // da marca sem pintar a tela inteira (no tema escuro, o mesmo véu sobre o
    // azul-marinho).
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-primary/10 via-pagina to-pagina px-4 py-8 sm:py-12">
      {/*
        `header` e `main` em vez de dois `div`.

        As telas de autenticação ficam FORA do AppShell, então não herdavam
        marco nenhum: o axe acusava `landmark-one-main` e `region` (nenhum
        conteúdo dentro de um marco) em `/login`, `/cadastro`,
        `/alterar-senha` e `/recuperar-senha`. Na prática, quem usa leitor de
        tela não tinha como pular direto ao formulário — e estas são as telas
        em que a pessoa ainda nem entrou no sistema.
      */}
      <header className="mb-6 flex flex-col items-center text-center">
        <IconeRedondo tamanho="lg" className="mb-3">
          <Sprout />
        </IconeRedondo>
        {/* Mesma marca do menu lateral; o nome acessível continua "CeasaPro". */}
        <h1 className="text-3xl font-bold tracking-tight">
          Ceasa<span className="text-primary">Pro</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestão simples para o seu box no CEASA
        </p>
      </header>
      <main className="w-full max-w-md">{children}</main>
      <footer className="mt-6 flex flex-wrap justify-center gap-x-1 text-sm text-muted-foreground">
        <Link href="/termos" className={linkDoRodape}>
          Termos de Uso
        </Link>
        <Link href="/privacidade" className={linkDoRodape}>
          Política de Privacidade
        </Link>
      </footer>
    </div>
  );
}
