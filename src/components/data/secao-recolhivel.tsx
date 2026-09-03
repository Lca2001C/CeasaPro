import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Seção que abre e fecha, feita com `<details>` nativo.
 *
 * Sem JavaScript e sem estado: a página do Início é Server Component, e o
 * `<details>` já entrega acessibilidade (teclado, leitor de tela) e
 * funcionamento mesmo antes de qualquer script carregar — o que importa numa
 * conexão ruim no box do CEASA.
 *
 * O Início mostrava 12 números, um gráfico e quatro listas de uma vez; no
 * celular isso é muita rolagem antes de chegar na ação. Aqui o detalhe fica
 * guardado atrás de um toque, e quem só quer "quanto vendi hoje" não paga por
 * ele.
 */
export function SecaoRecolhivel({
  titulo,
  descricao,
  children,
  abertaPorPadrao = false,
  ancoraTour,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
  abertaPorPadrao?: boolean;
  /**
   * Marca a seção como alvo do tour guiado (ver `lib/tour/roteiro`).
   *
   * É um parâmetro, e não um `<div>` de fora, porque envolver a seção num
   * elemento a mais mudaria o espaçamento da coluna onde ela vive — e o motivo
   * de o tour destacar isto é justamente que a seção fechada é o recurso que as
   * pessoas menos descobrem sozinhas.
   */
  ancoraTour?: string;
}) {
  return (
    <Card className="overflow-hidden" data-tour={ancoraTour}>
      <details open={abertaPorPadrao} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block font-medium">{titulo}</span>
            {descricao && (
              <span className="block text-xs text-muted-foreground">{descricao}</span>
            )}
          </span>
          <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t p-4">{children}</div>
      </details>
    </Card>
  );
}
