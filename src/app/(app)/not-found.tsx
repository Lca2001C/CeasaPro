import Link from "next/link";
import { Home, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * O que aparece quando um registro não existe (ou não é desta empresa).
 *
 * Há **dez** chamadas de `notFound()` na área da empresa — produto, fornecedor,
 * venda, fiado, despesa, higienização, relatório e cotação. Todas caíam no 404
 * padrão do Next: página branca, em inglês, sem menu e sem caminho de volta.
 *
 * E não é só link velho que chega aqui. `notFound()` também é o desfecho de
 * pedir um id de OUTRA empresa — a consulta filtra por `tenantId` e não acha —
 * então esta tela é, na prática, a resposta ao isolamento entre empresas
 * funcionando. Ela precisa ser tranquila e não sugerir defeito.
 *
 * Fica dentro do `(app)`, então mantém o AppShell: a navegação continua na tela.
 */
export default function NaoEncontrado() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <SearchX className="size-10 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold">Não encontramos este registro</h1>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Ele pode ter sido excluído, ou o link pode estar velho. Use o menu para
              voltar de onde veio.
            </p>
          </div>
          <Button asChild className="mt-2">
            <Link href="/dashboard">
              <Home className="size-4" />
              Ir para o Início
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
