import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Bell,
  Boxes,
  HandCoins,
  Package,
  Percent,
  ReceiptText,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { DashboardService, type DashboardProductRow } from "@/lib/services/dashboard.service";
import { AvisosService } from "@/lib/services/avisos.service";
import { formatBRL, formatDate, formatQty } from "@/lib/format";
import { StatCard } from "@/components/data/stat-card";
import { SalesChart } from "@/components/data/sales-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { tenantId } = await requireTenant();
  const [s, avisos] = await Promise.all([
    DashboardService.getSummary(tenantId),
    AvisosService.get(tenantId),
  ]);
  const lucroTone = s.lucroMes.isNegative() ? "destructive" : "success";
  const margemTone = s.margemLiquidaMes.isNegative() ? "destructive" : "success";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Início</h1>
        {avisos.length > 0 && (
          <Badge variant="warning" className="gap-1">
            <Bell className="size-3" />
            {avisos.length}
          </Badge>
        )}
      </div>

      {avisos.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            {avisos.map((aviso) => (
              <Link
                key={aviso.tipo}
                href={aviso.href}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0 text-warning" />
                  <span className="truncate">{aviso.label}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatBRL(aviso.total)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Números principais */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Hoje vendi"
          value={formatBRL(s.hojeVendi)}
          icon={<ShoppingCart className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Semana"
          value={formatBRL(s.semanaVendi)}
          icon={<TrendingUp className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Mês"
          value={formatBRL(s.mesVendi)}
          icon={<WalletCards className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Comprado"
          value={formatBRL(s.totalCompradoMes)}
          icon={<ReceiptText className="size-4" />}
        />
        <StatCard
          label="A receber"
          value={formatBRL(s.aReceber)}
          icon={<HandCoins className="size-4" />}
          tone="warning"
        />
        <StatCard
          label="A pagar"
          value={formatBRL(s.contasPagar)}
          icon={<ReceiptText className="size-4" />}
          tone="warning"
        />
        <StatCard
          label="Estoque"
          value={formatBRL(s.estoqueValor)}
          icon={<Package className="size-4" />}
        />
        <StatCard
          label="Lucro bruto"
          value={formatBRL(s.lucroBrutoMes)}
          icon={<TrendingUp className="size-4" />}
          tone={s.lucroBrutoMes.isNegative() ? "destructive" : "success"}
        />
        <StatCard
          label="Lucro líquido"
          value={formatBRL(s.lucroMes)}
          icon={<TrendingUp className="size-4" />}
          tone={lucroTone}
        />
        <StatCard
          label="Margem"
          value={`${formatQty(s.margemLiquidaMes)}%`}
          icon={<Percent className="size-4" />}
          tone={margemTone}
        />
        <StatCard
          label="Fixas"
          value={formatBRL(s.despesasFixasMes)}
          icon={<ReceiptText className="size-4" />}
        />
        <StatCard
          label="Variáveis"
          value={formatBRL(s.despesasVariaveisMes)}
          icon={<ReceiptText className="size-4" />}
        />
      </div>

      <Card>
        <CardContent className="pt-4">
          <SalesChart data={s.chart} />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <ProductList
          title="Mais vendidos"
          icon={<ShoppingCart className="size-4" />}
          rows={s.topVendidos}
          mode="quantity"
        />
        <ProductList
          title="Mais lucrativos"
          icon={<TrendingUp className="size-4" />}
          rows={s.topLucrativos}
          mode="profit"
        />
        <ProductList
          title="Com prejuízo"
          icon={<TrendingDown className="size-4" />}
          rows={s.produtosComPrejuizo}
          mode="profit"
          tone="destructive"
        />
        <Card>
          <CardContent className="pt-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Boxes className="size-4" />
              Estoque parado
            </div>
            {s.estoqueParado.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum produto parado com saldo.</p>
            ) : (
              <div className="flex flex-col divide-y">
                {s.estoqueParado.map((row) => (
                  <div key={row.productId} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Último movimento: {formatDate(row.lastMovementAt)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatQty(row.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Button asChild size="lg" className="w-full">
        <Link href="/vendas/nova">
          <ShoppingCart /> Nova venda
        </Link>
      </Button>
    </div>
  );
}

function ProductList({
  title,
  icon,
  rows,
  mode,
  tone = "default",
}: {
  title: string;
  icon: ReactNode;
  rows: DashboardProductRow[];
  mode: "quantity" | "profit";
  tone?: "default" | "destructive";
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados no mês.</p>
        ) : (
          <div className="flex flex-col divide-y">
            {rows.map((row) => (
              <div key={row.productId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatQty(row.quantity)} vendido(s) - {formatBRL(row.total)}
                  </p>
                </div>
                <span
                  className={
                    tone === "destructive"
                      ? "shrink-0 text-sm font-semibold tabular-nums text-destructive"
                      : "shrink-0 text-sm font-semibold tabular-nums"
                  }
                >
                  {mode === "quantity" ? formatQty(row.quantity) : formatBRL(row.profit)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
