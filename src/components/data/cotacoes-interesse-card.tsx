import Link from "next/link";
import { AlertTriangle, Bell, ChevronRight, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeloDeVariacao } from "@/components/data/selo-de-variacao";
import { formatBRL, formatDateOnly } from "@/lib/format";
import { frescorDoBoletim, rotuloDeFrescor } from "@/lib/cotacoes/frescor";
import { cn } from "@/lib/cn";
import type { InteressesDaEmpresa } from "@/lib/services/cotacoes-alertas.service";

/**
 * "Como está o preço do que eu compro" — no Início, sem abrir o módulo.
 *
 * O comerciante sai para o CEASA de madrugada e a pergunta que ele leva é essa.
 * Ter a resposta atrás de mais um toque significa, na prática, que ele vai sem
 * saber.
 *
 * Mostra POUCAS linhas de propósito, e ordenadas pelo movimento (ver
 * `getInteresses`): o cartão não é a tela de cotações, é o alerta de que vale a
 * pena abri-la. Uma lista de trinta itens aqui empurraria o resto do painel para
 * fora da primeira tela do celular.
 */

/**
 * Quantos itens cabem antes do cartão virar uma lista.
 *
 * Quatro é o que cabe numa tela de celular sem empurrar os números do dia para
 * baixo da dobra. O resto continua em `/cotacoes`, a um toque.
 */
const LINHAS_NO_CARTAO = 4;

export function CotacoesInteresseCard({
  interesses,
  agora,
}: {
  interesses: InteressesDaEmpresa;
  agora: Date;
}) {
  const frescor = frescorDoBoletim(
    interesses.quoteDate,
    agora,
    interesses.central.maxDiasSemBoletim,
  );
  const rotulo = rotuloDeFrescor(frescor);
  const visiveis = interesses.itens.slice(0, LINHAS_NO_CARTAO);
  const restantes = interesses.itens.length - visiveis.length;

  return (
    <Card className={cn(frescor.nivel === "defasado" && "border-warning/50")}>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="size-4 text-primary" aria-hidden="true" />
            Cotações do que você compra
          </span>
          {/*
            A data do BOLETIM, sempre, e com `formatDateOnly` — `quoteDate` é
            coluna `@db.Date` e formatá-la no fuso do app devolve o dia anterior.
            Sem a data, o cartão do Início daria a impressão de preço de agora, e
            preço velho repassado como novo é o único jeito de este módulo custar
            dinheiro a alguém.
          */}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Boletim de {formatDateOnly(interesses.quoteDate)}
            {rotulo && (
              <Badge
                variant={frescor.nivel === "defasado" ? "warning" : "secondary"}
                className="gap-1 px-1.5 py-0"
              >
                {frescor.nivel === "defasado" && (
                  <AlertTriangle className="size-2.5" aria-hidden="true" />
                )}
                {rotulo}
              </Badge>
            )}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          {visiveis.map((i) => (
            <Link
              key={`${i.ceasaProductId}-${i.unit}`}
              href={`/cotacoes/produto/${i.ceasaProductId}?u=${encodeURIComponent(i.unit)}`}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {/* Sino só onde há alerta configurado: é o que diferencia "eu
                    vendo isto" de "eu mandei vigiar isto". */}
                {i.alerta && (
                  <Bell className="size-3 shrink-0 text-primary" aria-hidden="true" />
                )}
                <span className="min-w-0 truncate">
                  {i.meuProdutoNome ?? i.nome}
                  <span className="ml-1 text-xs uppercase text-muted-foreground">{i.unit}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <SeloDeVariacao variacao={i.variacao} />
                <span className="font-semibold tabular-nums">{formatBRL(i.refPrice)}</span>
              </span>
            </Link>
          ))}
        </div>

        <Link
          href="/cotacoes"
          className="flex items-center justify-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {restantes > 0
            ? `Ver todas as cotações (+${restantes})`
            : "Ver todas as cotações"}
          <ChevronRight className="size-3" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
