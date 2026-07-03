import Link from "next/link";
import { ShoppingCart, HandCoins, Package, TrendingUp } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { DashboardService } from "@/lib/services/dashboard.service";
import { formatBRL } from "@/lib/format";
import { StatCard } from "@/components/data/stat-card";
import { SalesChart } from "@/components/data/sales-chart";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { tenantId } = await requireTenant();
  const s = await DashboardService.getSummary(tenantId);
  const lucroTone = s.lucroMes.isNegative() ? "destructive" : "success";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Início</h1>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Hoje vendi"
          value={formatBRL(s.hojeVendi)}
          icon={<ShoppingCart className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Tenho para receber"
          value={formatBRL(s.aReceber)}
          icon={<HandCoins className="size-4" />}
          tone="warning"
        />
        <StatCard
          label="Estoque"
          value={formatBRL(s.estoqueValor)}
          icon={<Package className="size-4" />}
        />
        <StatCard
          label="Lucro do mês"
          value={formatBRL(s.lucroMes)}
          icon={<TrendingUp className="size-4" />}
          tone={lucroTone}
        />
      </div>

      <Card>
        <CardContent className="pt-4">
          <SalesChart data={s.chart} />
        </CardContent>
      </Card>

      <Button asChild size="lg" className="w-full">
        <Link href="/vendas/nova">
          <ShoppingCart /> Nova venda
        </Link>
      </Button>
    </div>
  );
}
