import Link from "next/link";
import { Package, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBRL, formatDayMonthOnly, formatQty, valorExibivel } from "@/lib/format";
import { nivelEstoque } from "@/lib/estoque/nivel";
import { precoPorKg, rotuloDeEmbalagem } from "@/lib/cotacoes/embalagem";
import type { LinhaDeCotacao } from "@/lib/services/cotacoes.service";
import { Minigrafico } from "./minigrafico";
import { SeloDeVariacao } from "@/components/data/selo-de-variacao";

/**
 * Um produto do boletim, do tamanho de um cartão.
 *
 * É um `<Link>` inteiro, e não um cartão com um botão dentro: o alvo de toque
 * passa a ser o cartão todo, que é o que funciona com a mão suja de caixa no
 * corredor do CEASA. Server Component — não há estado nem evento aqui, e mandar
 * JavaScript para desenhar preço seria pagar bytes por nada.
 */
export function CartaoDeCotacao({ linha }: { linha: LinhaDeCotacao }) {
  // "Você vende" é ter o VÍNCULO NESTA EMBALAGEM, não ter saldo hoje. É a
  // resposta à pergunta "isto é da minha lista?", que é a que faz o cartão saltar
  // aos olhos no meio de duzentos e quarenta. O saldo é informação a mais, na
  // linha de baixo.
  const euVendo = linha.vinculo === "exato";
  /*
    Mesmo item, outra embalagem: marca discreta, não a estrela verde.

    Este cartão não pode virar destaque — quem escolheu a caixa não quer a linha
    do quilo competindo com ela na seção "Produtos que você vende". Mas também
    não pode ficar anônimo: é ele que responde "meu tomate está a R$ 85 a caixa
    E a R$ 4,20 o quilo", que é uma pergunta que o comerciante faz.
  */
  const outraEmbalagem = linha.vinculo === "outra_embalagem";
  const temSaldo =
    euVendo && linha.meuSaldo !== null && nivelEstoque(linha.meuSaldo) !== "zerado";
  // Só quando a embalagem não é o próprio quilo, e só quando o boletim declara
  // o peso — ver `pesoEmKg`. Sem isso o cartão inventaria uma conversão.
  const porKg = linha.unit.trim().toUpperCase() === "KG" ? null : precoPorKg(linha.refPrice, linha.unit);

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
          ) : outraEmbalagem ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <Package className="size-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                sua embalagem: {rotuloDeEmbalagem(linha.minhaEmbalagem)}
              </span>
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
        {/*
          O quilo equivalente, quando o BOLETIM declara o peso da embalagem
          ("CX 20 KG" → 20 kg). É o que permite comparar caixa com quilo sem
          fazer conta de cabeça no corredor.

          O "≈" e o "pelo peso do boletim" não são enfeite: o número é derivado,
          não publicado, e o comerciante tem direito de saber de onde ele veio
          antes de repassar ao preço do balcão. Embalagem sem peso declarado
          (`DZ`, `CX 30 DZ`) não mostra linha nenhuma — ver `pesoEmKg`.
        */}
        {porKg && (
          <p className="text-[11px] text-muted-foreground">
            ≈ <span className="tabular-nums">{formatBRL(porKg)}</span>/kg pelo peso do boletim
          </p>
        )}

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
