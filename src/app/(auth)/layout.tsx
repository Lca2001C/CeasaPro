import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-accent/80 to-secondary/40 p-4">
      {/*
        `header` e `main` em vez de dois `div`.

        As telas de autenticação ficam FORA do AppShell, então não herdavam
        marco nenhum: o axe acusava `landmark-one-main` e `region` (nenhum
        conteúdo dentro de um marco) em `/login`, `/cadastro`,
        `/alterar-senha` e `/recuperar-senha`. Na prática, quem usa leitor de
        tela não tinha como pular direto ao formulário — e estas são as telas
        em que a pessoa ainda nem entrou no sistema.
      */}
      <header className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-primary">CeasaPro</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestão simples para o seu box no CEASA
        </p>
      </header>
      <main className="w-full max-w-sm">{children}</main>
      <footer className="mt-8 flex gap-4 text-xs text-muted-foreground">
        <Link href="/termos" className="hover:underline">
          Termos de Uso
        </Link>
        <Link href="/privacidade" className="hover:underline">
          Política de Privacidade
        </Link>
      </footer>
    </div>
  );
}
