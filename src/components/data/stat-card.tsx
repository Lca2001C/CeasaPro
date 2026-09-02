import * as React from "react";
import { cn } from "@/lib/cn";
import { valorExibivel } from "@/lib/format";
import { Card } from "@/components/ui/card";

interface Props {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "destructive";
}

const toneClasses: Record<NonNullable<Props["tone"]>, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

/**
 * Largura média de um caractere, em fração do tamanho da fonte.
 *
 * Medida para a fonte do app em peso bold com `tabular-nums` — que é o caso
 * relevante, porque com numerais tabulares todo dígito tem a MESMA largura, e o
 * valor é quase todo dígito. Sobra folga para "R$" e separadores.
 *
 * É uma estimativa, não uma medição do navegador. A garantia de que nada
 * escapa da caixa não depende dela: vem do `overflow-wrap` mais abaixo. Esta
 * constante só decide o tamanho da letra para que, na prática, o valor caiba
 * numa linha só.
 */
const LARGURA_POR_CARACTERE = 0.62;

/** Margem de segurança sobre a largura do cartão (4%). */
const APROVEITAMENTO = 96;

/** Igual ao `text-3xl` de antes: o tamanho de um valor curto num cartão largo. */
const TAMANHO_MAXIMO = "1.875rem";

/**
 * Piso de legibilidade.
 *
 * 0.75rem (12px) cobre até cerca de 15 caracteres — "R$ 1.000.000,00" — num
 * cartão de duas colunas em celular pequeno. Acima disso o valor quebra em duas
 * linhas em vez de encolher mais, porque número que ninguém consegue ler não
 * informa nada.
 */
const TAMANHO_MINIMO = "0.75rem";

/**
 * Tamanho da fonte do valor, em função do COMPRIMENTO dele e da largura real do
 * cartão.
 *
 * `cqi` é 1% da largura do container — o próprio cartão, graças ao `@container`.
 * Por que container query e não `sm:`/`lg:`: a largura do cartão não acompanha a
 * largura da tela de forma monótona. Este grid é `grid-cols-2` no celular e
 * `lg:grid-cols-4` no desktop, então o cartão tem ~113px no celular, ~290px no
 * tablet (ainda 2 colunas) e ~220px no desktop (já 4 colunas). Um degrau por
 * breakpoint de tela erraria justamente o caso do meio; a container query
 * pergunta à caixa, que é o que importa.
 */
function tamanhoDoValor(texto: string): string {
  const caracteres = Math.max(texto.length, 1);
  const cqi = APROVEITAMENTO / (caracteres * LARGURA_POR_CARACTERE);
  return `clamp(${TAMANHO_MINIMO}, ${cqi.toFixed(2)}cqi, ${TAMANHO_MAXIMO})`;
}

/**
 * Cartão de número (KPI) — leitura rápida, um valor em destaque.
 *
 * A regra que este componente garante: **o conteúdo nunca escapa da caixa**,
 * qualquer que seja o tamanho do valor. Valor cortado na borda é pior que valor
 * pequeno; num painel financeiro, "R$ 11.000,00" aparado na metade pode ser lido
 * como "R$ 11,00".
 */
export function StatCard({ label, value, hint, icon, tone = "default" }: Props) {
  const exibivel = valorExibivel(value);

  return (
    <Card className="@container p-4">
      <div className="flex items-start justify-between gap-2">
        {/*
          `min-w-0` no rótulo e `shrink-0` no ícone: sem os dois, um rótulo
          comprido ("Contas variáveis") empurra o ícone para fora do cartão em
          vez de quebrar a linha.

          `overflow-wrap:anywhere` porque `min-w-0` sozinho não basta: ele deixa
          a CAIXA encolher, mas o texto continua precisando de um lugar para
          quebrar. "Perdidas/quebradas" (tela de caixas plásticas) não tem
          espaço nenhum, então vazava 11px do cartão em tela de 320px.
        */}
        <span className="min-w-0 text-sm font-medium text-muted-foreground [overflow-wrap:anywhere]">
          {label}
        </span>
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      </div>
      <div
        className={cn(
          // `overflow-wrap:anywhere` é a garantia final: mesmo que a estimativa
          // de largura erre, o texto quebra dentro do cartão em vez de vazar.
          "mt-2 font-bold leading-tight tabular-nums [overflow-wrap:anywhere]",
          toneClasses[tone],
        )}
        style={{ fontSize: tamanhoDoValor(exibivel) }}
      >
        {exibivel}
      </div>
      {hint && (
        <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{hint}</p>
      )}
    </Card>
  );
}
