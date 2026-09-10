"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * O que o dono do box vê quando uma tela da área da empresa quebra.
 *
 * Até esta auditoria não havia NENHUM error boundary em toda a árvore: uma
 * exceção em qualquer Server Component caía na página de erro padrão do Next —
 * sem menu, sem caminho de volta, em inglês. Para quem está no balcão com o
 * celular, isso é um beco: a única saída é fechar o app.
 *
 * Fica dentro do `(app)`, então herda o AppShell: a barra de navegação continua
 * na tela e a pessoa consegue ir para outro lugar sem recarregar nada.
 *
 * Três decisões que valem explicar:
 *
 * 1. **`retry()` em primeiro lugar.** Nesta versão do Next a prop chama `retry`
 *    (não `reset`), e ela re-renderiza o segmento sem recarregar a página. Boa
 *    parte das falhas aqui é momentânea — pool do banco saturado, soluço de
 *    rede no Neon — e tentar de novo resolve sem perder a navegação.
 * 2. **A mensagem do erro NÃO é mostrada.** Em produção o Next já entrega texto
 *    genérico para erro de Server Component justamente para não vazar nome de
 *    tabela ou caminho de arquivo; mostrar `error.message` só exibiria isso em
 *    desenvolvimento e treinaria a olhar um campo que fica vazio no ar.
 * 3. **O `digest` aparece**, discreto. É o identificador que casa com o log do
 *    servidor: sem ele, o suporte recebe "deu erro" e não tem por onde começar.
 */
export default function ErroDaArea({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // O log do servidor já tem o erro completo (com o `digest` para casar). Aqui
    // é o console do navegador, que é onde se olha quando o relato vem do
    // cliente — "abri e deu erro" sem nada no servidor costuma ser falha de
    // Client Component, e só aparece aqui.
    console.error("Erro na área da empresa:", error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-destructive/40 p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="size-10 text-destructive" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold">Não conseguimos abrir esta tela</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              O problema foi do nosso lado, não do que você fez. Seus dados estão
              salvos — nada do que você lançou se perdeu.
            </p>
          </div>

          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button onClick={() => retry()}>
              <RotateCw className="size-4" />
              Tentar de novo
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">
                <Home className="size-4" />
                Ir para o Início
              </Link>
            </Button>
          </div>

          {error.digest && (
            <p className="mt-2 text-xs text-muted-foreground">
              Se acontecer de novo, informe este código ao suporte:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{error.digest}</code>
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
