import Link from "next/link";
import { AlertTriangle, ChevronRight, Plus, Container } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { FiadoService } from "@/lib/services/fiado.service";
import { fiadoStatusFiltroEnum, type FiadoStatusFiltro } from "@/lib/validations/fiado";
import { formatBRL, formatDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { startOfDayTz } from "@/lib/tz";
import {
  PrecoResumo,
  ProdutosResumo,
  QuantidadeResumo,
} from "./_components/fiado-linha";
import { BuscaFiado } from "./_components/busca-fiado";
import { ReceberRapido } from "./_components/receber-rapido";

export const dynamic = "force-dynamic";

const FILTROS: { value: FiadoStatusFiltro; label: string }[] = [
  { value: "EM_ABERTO", label: "Em aberto" },
  { value: "PAGO", label: "Pagas" },
  { value: "TODAS", label: "Todas" },
];

export default async function FiadoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status: rawStatus, q } = await searchParams;
  const status = fiadoStatusFiltroEnum.safeParse(rawStatus).data ?? "EM_ABERTO";
  const busca = q?.trim() || undefined;

  const { tenantId } = await requireTenant();
  const { contas, totalGeral, totalCaixas } = await FiadoService.listOpen(
    tenantId,
    status,
    busca,
  );

  // Vencida = tem data de vencimento no passado e ainda deve. Comparar por dia
  // brasileiro: `new Date()` puro faria uma conta vencer às 21h do dia anterior.
  const hoje = startOfDayTz(new Date());
  const estaVencida = (c: (typeof contas)[number]) =>
    c.status === "EM_ABERTO" && c.dueDate !== null && c.dueDate < hoje;
  const vencidas = contas.filter(estaVencida).length;

  return (
    <div>
      <PageHeader
        title="Fiado"
        description="Contas a receber dos clientes."
        action={
          <Button asChild size="sm">
            <Link href="/fiado/novo">
              <Plus /> Novo fiado
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard label="Total a receber" value={formatBRL(totalGeral)} tone="warning" />
        <StatCard
          label="Caixas com clientes"
          value={String(totalCaixas)}
          hint="Contas em aberto"
          icon={<Container className="size-4" />}
        />
      </div>

      {vencidas > 0 && (
        <Card className="mb-4 flex items-center gap-2 border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <span>
            <b>
              {vencidas} conta{vencidas > 1 ? "s" : ""}
            </b>{" "}
            passou do vencimento.
          </span>
        </Card>
      )}

      <div className="mb-3">
        <BuscaFiado />
      </div>

      <div className="mb-4 flex gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant={status === f.value ? "default" : "outline"}
          >
            <Link href={`/fiado?status=${f.value}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`}>
              {f.label}
            </Link>
          </Button>
        ))}
      </div>

      {contas.length === 0 ? (
        <EmptyState
          title={status === "PAGO" ? "Nenhuma conta quitada" : "Nenhuma conta em aberto"}
          description="Vendas na forma Fiado aparecem aqui para você controlar o recebimento."
          action={
            <Button asChild>
              <Link href="/fiado/novo">
                <Plus /> Lançar fiado
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Telas largas: a mesma leitura da planilha, uma linha por entrega. */}
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Caixas</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contas.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-accent/40">
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <Link href={`/fiado/${c.id}`} className="block">
                        {formatDate(c.saleDate)}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[10rem]">
                      <Link href={`/fiado/${c.id}`} className="flex items-center gap-2">
                        <span className="truncate font-medium">{c.customerName}</span>
                        {c.status === "PAGO" && <Badge variant="success">Quitada</Badge>}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[12rem]">
                      <ProdutosResumo itens={c.itens} />
                    </TableCell>
                    <TableCell className="text-right">
                      <QuantidadeResumo itens={c.itens} />
                    </TableCell>
                    <TableCell className="text-right">
                      <PrecoResumo itens={c.itens} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatBRL(c.totalAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.plasticCrateQty > 0 ? c.plasticCrateQty : "—"}
                      {c.caixasComCliente > 0 && (
                        <span className="block text-xs text-warning">
                          {c.caixasComCliente} a devolver
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        c.status === "PAGO"
                          ? "text-success"
                          : estaVencida(c)
                            ? "text-destructive"
                            : "text-warning",
                      )}
                    >
                      {formatBRL(c.saldo)}
                      {estaVencida(c) && (
                        <span className="block text-xs font-normal">
                          venceu {formatDate(c.dueDate)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === "EM_ABERTO" && (
                        <ReceberRapido
                          accountId={c.id}
                          customerName={c.customerName}
                          saldo={Number(c.saldo)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Celular: os mesmos dados empilhados — no balcão a tela é estreita
              e uma tabela de 8 colunas viraria rolagem lateral. */}
          <div className="flex flex-col gap-2 md:hidden">
            {contas.map((c) => (
              <Link key={c.id} href={`/fiado/${c.id}`}>
                <Card
                  className={cn(
                    "flex items-center justify-between gap-2 p-3 hover:bg-accent/40",
                    estaVencida(c) && "border-destructive/50 bg-destructive/5",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.customerName}</span>
                      {c.status === "PAGO" && <Badge variant="success">Quitada</Badge>}
                      {estaVencida(c) && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="size-3" /> Vencida
                        </Badge>
                      )}
                      {c.plasticCrateQty > 0 && (
                        <Badge variant="secondary">{c.plasticCrateQty} cx</Badge>
                      )}
                    </div>
                    <span className="block truncate text-xs">
                      <ProdutosResumo itens={c.itens} />
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(c.saleDate)}
                      {c.itens.length === 1
                        ? ` · ${formatQty(c.itens[0].quantity)} × ${formatBRL(c.itens[0].unitPrice)}`
                        : ""}
                      {c.dueDate ? ` · vence ${formatDate(c.dueDate)}` : ""}
                      {c.caixasComCliente > 0
                        ? ` · ${c.caixasComCliente} caixa(s) a devolver`
                        : ""}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <span
                        className={cn(
                          "block font-semibold tabular-nums",
                          c.status === "PAGO"
                            ? "text-success"
                            : estaVencida(c)
                              ? "text-destructive"
                              : "text-warning",
                        )}
                      >
                        {formatBRL(c.saldo)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        de {formatBRL(c.totalAmount)}
                      </span>
                    </div>
                    {c.status === "EM_ABERTO" && (
                      <ReceberRapido
                        accountId={c.id}
                        customerName={c.customerName}
                        saldo={Number(c.saldo)}
                      />
                    )}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
