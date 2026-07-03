import { formatBRL } from "@/lib/format";

interface Props {
  data: { date: string; total: number }[];
}

/** Gráfico de barras simples (vendas por dia) — leitura rápida, sem libs pesadas. */
export function SalesChart({ data }: Props) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const totalPeriodo = data.reduce((a, d) => a + d.total, 0);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          Vendas dos últimos 30 dias
        </span>
        <span className="text-sm font-semibold">{formatBRL(totalPeriodo)}</span>
      </div>
      <div className="flex h-28 items-end gap-[2px]">
        {data.map((d) => {
          const h = Math.round((d.total / max) * 100);
          const label = `${new Date(d.date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}: ${formatBRL(d.total)}`;
          return (
            <div
              key={d.date}
              className="flex-1 rounded-t-sm bg-primary/70 transition-colors hover:bg-primary"
              style={{ height: `${Math.max(h, 2)}%` }}
              title={label}
            />
          );
        })}
      </div>
    </div>
  );
}
