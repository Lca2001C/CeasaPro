import Link from "next/link";
import { Package, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBRL, formatDayMonthOnly, formatQty, valorExibivel } from "@/lib/format";
import { nivelEstoque } from "@/lib/estoque/nivel";
import type { LinhaDeCotacao } from "@/lib/services/cotacoes.service";
import { Minigrafico } from "./minigrafico";
import { SeloDeVariacao } from "./selo-de-variacao";

/**
 * Um produto do boletim, do tamanho de um cartão.
 *
 * É um `<Link>` inteiro, e não um cartão com um botão dentro: o alvo de toque
 * passa a ser o cartão todo, que é o que funciona com a mão suja de caixa no
 * corredor do CEASA. Server Component — não há estado nem evento aqui, e mandar
 * JavaScript para desenhar preço seria pagar bytes por nada.
 */
export function CartaoDeCotacao({ linha }: { linha: LinhaDeCotacao }) {
  // "Você vende" é ter o VÍNCULO, não ter saldo hoje. É a resposta à pergunta
  // "isto é da minha lista?", que é a que faz o cartão saltar aos olhos no meio
  // de duzentos e quarenta. O saldo é informação a mais, na linha de baixo.
  const euVendo = Boolean(linha.meuProdutoId);
  const temSaldo = linha.meuSaldo !== null && nivelEstoque(linha.meuSaldo) !== "zerado";

  return (
    <Link
      href={`/cotacoes/produto/${linha.ceasaProductId}?u=${encodeURIComponent(linha.unit)}`}
      className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div
        className={cn(
          "flex h-full flex-col rounded-lg border bg-card p-3 shadow-sm transition-colors",
          "hover:border-primary/60 hover:bg-accent/40",
          euVendo && "border-success/50 bg-success/5 hover:border-success",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          {euVendo ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
              <Star className="size-2.5 fill-current" aria-hidden="true" />
              Você vende
            </span>
          ) : (
            <span />
          )}
          <SeloDeVariacao variacao={linha.variacao} />
        </div>

        <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-tight">
          {linha.ceasaProductName}
        </p>
        <p className="text-xs uppercase text-muted-foreground">
          {linha.unit || "unidade não informada"}
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <p className="text-xl font-bold leading-none tabular-nums">
              {linha.refPrice ? valorExibivel(formatBRL(linha.refPrice)) : "—"}
            </p>
            {/*
              A data do boletim anterior aparece SEMPRE que há um, e o texto
              nunca diz "ontem". A praça não publica todo dia — medido em 8 dias
              úteis seguidos, quatro das sete unidades de Minas publicam 2 a 3
              vezes por semana — e produto fora de safra some do boletim por
              semanas. "Ontem: R$ 5,88" para um preço de seis dias atrás é
              exatamente o erro que faz repassar preço velho como se fosse novo.
            */}
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {linha.anterior ? (
                <>
                  {formatDayMonthOnly(linha.anterior.quoteDate)}:{" "}
                  <span className="tabular-nums">{formatBRL(linha.anterior.refPrice)}</span>
                </>
              ) : (
                "primeiro boletim deste produto"
              )}
            </p>
          </div>
          <div className={cn("text-muted-foreground", euVendo && "text-success")}>
            <Minigrafico valores={linha.serie} />
          </div>
        </div>

        {temSaldo && (
          <p className="mt-2 flex items-center gap-1 border-t pt-2 text-[11px] text-muted-foreground">
            <Package className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              Você tem {formatQty(linha.meuSaldo!)}
              {linha.meuProdutoNome ? ` de ${linha.meuProdutoNome}` : ""}
            </span>
          </p>
        )}
      </div>
    </Link>
  );
}
