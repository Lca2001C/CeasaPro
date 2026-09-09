import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { direcaoDaVariacao, rotuloDeVariacao } from "@/lib/cotacoes/variacao";

/**
 * A seta e o percentual de variação entre um boletim e o anterior.
 *
 * **Por que alta é vermelha e baixa é verde.** A convenção do mercado
 * financeiro é o contrário, e a escolha aqui é deliberada: para este usuário a
 * cotação do CEASA é, antes de tudo, o preço que ele PAGA. A própria tela de
 * escolha da praça diz "Escolha em qual central você compra". Alta é custo
 * subindo; baixa é oportunidade de compra. Inverter isso pintaria de verde,
 * todo dia, a notícia mais cara da semana dele.
 *
 * Quem for mexer nisto depois: a cor não é enfeite, e a seta sozinha não
 * resolve — quem lê o cartão de relance lê a cor primeiro.
 */
export function SeloDeVariacao({
  variacao,
  className,
}: {
  variacao: number | null;
  className?: string;
}) {
  const direcao = direcaoDaVariacao(variacao);
  const rotulo = rotuloDeVariacao(variacao);
  // Sem preço anterior não há variação — e "0%" seria mentira, não ausência.
  // O cartão simplesmente não mostra selo, e o texto do preço anterior explica.
  if (!direcao || !rotulo) return null;

  const Icone = direcao === "alta" ? TrendingUp : direcao === "baixa" ? TrendingDown : Minus;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        direcao === "alta" && "bg-destructive/10 text-destructive",
        direcao === "baixa" && "bg-success/10 text-success",
        direcao === "estavel" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icone className="size-3" aria-hidden="true" />
      {rotulo}
    </span>
  );
}
