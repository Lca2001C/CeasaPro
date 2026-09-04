import Link from "next/link";
import type { ReactNode } from "react";
import { OfflineSync } from "@/components/pwa/offline-sync";
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
import { ContasPagarService } from "@/lib/services/contas-pagar.service";
import { DespesasService } from "@/lib/services/despesas.service";
import { ContasAPagarCard } from "@/components/data/contas-a-pagar-card";
import { startOfDayTz } from "@/lib/tz";
import { formatBRL, formatDate, formatQty, valorExibivel } from "@/lib/format";
import { StatCard } from "@/components/data/stat-card";
import { SecaoRecolhivel } from "@/components/data/secao-recolhivel";
import { SalesChart } from "@/components/data/sales-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConviteTour } from "@/components/tour/convite-tour";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { tenantId, session } = await requireTenant();
  const [s, avisos, contas, proximas] = await Promise.all([
    DashboardService.getSummary(tenantId),
    AvisosService.get(tenantId),
    // "Tudo a pagar": despesas + higienização somadas, porque o cliente pensa
    // em "quanto tenho que pagar", não em módulos.
    ContasPagarService.get(tenantId, session.modules),
    DespesasService.proximasContas(tenantId),
  ]);
  const hoje = startOfDayTz(new Date());
  const lucroTone = s.lucroMes.isNegative() ? "destructive" : "success";
  const margemTone = s.margemLiquidaMes.isNegative() ? "destructive" : "success";

  return (
    <div className="flex flex-col gap-4">
      {/*
        Guarda o snapshot de consulta offline. Fica AQUI, e não num intervalo
        global, porque sem Background Sync no iOS o sincronismo só acontece com o
        app aberto — e esta é a tela que todo mundo abre, com os mesmos números.
        Não renderiza nada; tem debounce de 5 min por dentro.
      */}
      <OfflineSync />

      {/* Convite ao tour guiado. Some depois de aceito ou dispensado — a
          discussão de por que é um cartão, e não um painel, está no componente. */}
      <ConviteTour />

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
                className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <span className="flex min-w-0 items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{aviso.label}</span>
                </span>
                <span className="shrink-0 self-end font-semibold tabular-nums sm:self-auto">
                  {valorExibivel(formatBRL(aviso.total))}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Contas a pagar reunidas: despesas + higienização, com as três mais
          próximas clicáveis. Fica logo abaixo dos avisos porque responde a
          pergunta que eles levantam: "o que eu preciso resolver hoje?". */}
      {/* `data-tour`: âncoras do tour guiado (ver `lib/tour/roteiro`). */}
      <div data-tour="dashboard-a-pagar">
        <ContasAPagarCard
          contas={contas}
          proximas={proximas.itens.map((c) => ({
            id: c.id,
            description: c.description,
            amount: c.amount.toString(),
            dueDate: c.dueDate?.toISOString() ?? null,
            categoryName: c.category?.name ?? null,
            vencida: c.dueDate !== null && c.dueDate < hoje,
          }))}
          totalProximas={proximas.total.toString()}
          countProximas={proximas.count}
        />
      </div>

      {/* A ação principal fica no TOPO: quem abre o app no balcão quer vender,
          não rolar doze números até achar o botão. */}
      <Button asChild size="lg" className="h-14 w-full text-base" data-tour="dashboard-vender">
        <Link href="/vendas/nova">
          <ShoppingCart className="size-5" /> Nova venda
        </Link>
      </Button>

      {/* Os quatro números do dia a dia. O resto vive nas seções abaixo. */}
      <div className="grid grid-cols-2 gap-3" data-tour="dashboard-numeros">
        <StatCard
          label="Hoje vendi"
          value={formatBRL(s.hojeVendi)}
          icon={<ShoppingCart className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Clientes me devem"
          value={formatBRL(s.aReceber)}
          hint="Fiado a receber"
          icon={<HandCoins className="size-4" />}
          tone="warning"
        />
        <StatCard
          label="Tenho em estoque"
          value={formatBRL(s.estoqueValor)}
          hint="Valor da mercadoria"
          icon={<Package className="size-4" />}
        />
        <StatCard
          label="Sobrou no mês"
          value={formatBRL(s.lucroMes)}
          hint="Lucro líquido"
          icon={<TrendingUp className="size-4" />}
          tone={lucroTone}
        />
      </div>

      <SecaoRecolhivel
        titulo="Ver financeiro completo"
        descricao="Vendas da semana e do mês, contas e lucro"
        ancoraTour="dashboard-detalhes"
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Vendi na semana"
            value={formatBRL(s.semanaVendi)}
            icon={<TrendingUp className="size-4" />}
            tone="success"
          />
          <StatCard
            label="Vendi no mês"
            value={formatBRL(s.mesVendi)}
            icon={<WalletCards className="size-4" />}
            tone="success"
          />
          <StatCard
            label="Comprei no mês"
            value={formatBRL(s.totalCompradoMes)}
            icon={<ReceiptText className="size-4" />}
          />
          <StatCard
            label="Contas do mês"
            value={formatBRL(s.contasPagar)}
            hint="A pagar"
            icon={<ReceiptText className="size-4" />}
            tone="warning"
          />
          <StatCard
            label="Ganhei nas vendas"
            value={formatBRL(s.lucroBrutoMes)}
            hint="Lucro bruto — antes das contas"
            icon={<TrendingUp className="size-4" />}
            tone={s.lucroBrutoMes.isNegative() ? "destructive" : "success"}
          />
          <StatCard
            label="Sobrou em %"
            value={`${formatQty(s.margemLiquidaMes)}%`}
            hint="Margem líquida"
            icon={<Percent className="size-4" />}
            tone={margemTone}
          />
          <StatCard
            label="Contas fixas"
            value={formatBRL(s.despesasFixasMes)}
            hint="Aluguel, luz, salário…"
            icon={<ReceiptText className="size-4" />}
          />
          <StatCard
            label="Contas variáveis"
            value={formatBRL(s.despesasVariaveisMes)}
            hint="Mudam todo mês"
            icon={<ReceiptText className="size-4" />}
          />
        </div>

        <div className="mt-4">
          <SalesChart data={s.chart} />
        </div>
      </SecaoRecolhivel>

      <SecaoRecolhivel
        titulo="Ver produtos"
        descricao="Mais vendidos, mais lucrativos, prejuízo e estoque parado"
      >
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
                    <div
                      key={row.productId}
                      className="flex items-center justify-between gap-3 py-2"
                    >
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
      </SecaoRecolhivel>
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
