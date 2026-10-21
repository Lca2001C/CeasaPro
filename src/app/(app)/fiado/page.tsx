import Link from "next/link";
import { CartaoDeAcao } from "@/components/ui/cartao-de-acao";
import { redirect } from "next/navigation";
import { AlertTriangle, ChevronRight, Plus, Container, HandCoins } from "lucide-react";
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
import { IconeRedondo } from "@/components/ui/icone-redondo";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { startOfDayTz } from "@/lib/tz";
import { paginaDaUrl } from "@/lib/paginacao";
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
  { value: "PERDA", label: "Perdas" },
  { value: "TODAS", label: "Todas" },
];

export default async function FiadoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; pagina?: string }>;
}) {
  const { status: rawStatus, q, pagina: rawPagina } = await searchParams;
  const status = fiadoStatusFiltroEnum.safeParse(rawStatus).data ?? "EM_ABERTO";
  const busca = q?.trim() || undefined;
  const paginaPedida = paginaDaUrl(rawPagina);

  const { tenantId } = await requireTenant();
  const agora = new Date();
  // "Pagas" e "Todas" são paginadas (crescem para sempre); "Em aberto" não —
  // ver `FIADO_POR_PAGINA`. Os cartões e o aviso de vencidas somam todas as
  // contas em aberto, nunca só a página.
  const { contas, totalGeral, totalCaixas, vencidas, total, pagina, ultimaPagina } =
    await FiadoService.listOpen(tenantId, status, busca, { pagina: paginaPedida, agora });

  const linkPara = (patch: { status?: string; pagina?: number }) => {
    const sp = new URLSearchParams();
    sp.set("status", patch.status ?? status);
    if (busca) sp.set("q", busca);
    if (patch.pagina && patch.pagina > 1) sp.set("pagina", String(patch.pagina));
    return `/fiado?${sp.toString()}`;
  };

  // Página que não existe (URL editada, ou a lista encurtou): vai para a
  // última válida em vez de dizer "nenhuma conta" — que seria mentira.
  if (pagina > ultimaPagina && total > 0) {
    redirect(linkPara({ pagina: ultimaPagina }));
  }

  // Vencida = tem data de vencimento no passado e ainda deve. Comparar por dia
  // brasileiro: `new Date()` puro faria uma conta vencer às 21h do dia anterior.
  const hoje = startOfDayTz(agora);
  const estaVencida = (c: (typeof contas)[number]) =>
    c.status === "EM_ABERTO" && c.dueDate !== null && c.dueDate < hoje;

  // Cor do saldo — só estado: verde quitada, vermelho vencida, amarelo em aberto.
  const corDoSaldo = (c: (typeof contas)[number]) =>
    c.status === "PAGO"
      ? "text-success"
      : c.status === "PERDA"
        ? "text-muted-foreground"
        : estaVencida(c)
          ? "text-destructive"
          : "text-warning";

  return (
    <div>
      <PageHeader
        title="Fiado"
        description="Contas a receber dos clientes."
      />

      <CartaoDeAcao
        href="/fiado/novo"
        titulo="Lançar Novo Fiado"
        descricao="Entrega para pagar depois, com cliente e vencimento"
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Total a receber"
            value={formatBRL(totalGeral)}
            tone="warning"
            icon={<HandCoins className="size-4" />}
          />
          <StatCard
            label="Caixas com clientes"
            value={String(totalCaixas)}
            hint="Contas em aberto"
            icon={<Container className="size-4" />}
          />
        </div>

        {vencidas > 0 && (
          <Card className="flex items-center gap-3 border-destructive/40 bg-destructive/5 p-4">
            <IconeRedondo tom="destructive" tamanho="sm">
              <AlertTriangle />
            </IconeRedondo>
            <span className="min-w-0 text-sm">
              <b>
                {vencidas} conta{vencidas > 1 ? "s" : ""}
              </b>{" "}
              passou do vencimento.
            </span>
          </Card>
        )}

        <div className="flex flex-col gap-3">
          <BuscaFiado />

          <nav aria-label="Situação das contas" className="flex flex-wrap gap-2">
            {FILTROS.map((f) => (
              <Button
                key={f.value}
                asChild
                size="sm"
                variant={status === f.value ? "default" : "outline"}
              >
                <Link
                  href={linkPara({ status: f.value })}
                  aria-current={status === f.value ? "page" : undefined}
                >
                  {f.label}
                </Link>
              </Button>
            ))}
          </nav>
        </div>

        {contas.length === 0 ? (
          <EmptyState
            title={
              status === "PAGO"
                ? "Nenhuma conta quitada"
                : status === "PERDA"
                  ? "Nenhum fiado baixado como perda"
                  : "Nenhuma conta em aberto"
            }
            description="Vendas na forma Fiado aparecem aqui para você controlar o recebimento."
            icon={<HandCoins />}
            action={
              <Button asChild>
                <Link href="/fiado/novo">
                  <Plus /> Lançar fiado
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Telas largas: a mesma leitura da planilha, uma linha por entrega. */}
            <Card className="hidden overflow-hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
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
                    <TableRow
                      key={c.id}
                      className={cn(
                        "cursor-pointer hover:bg-muted/60",
                        estaVencida(c) && "bg-destructive/5",
                      )}
                    >
                      <TableCell className="whitespace-nowrap tabular-nums">
                        <Link href={`/fiado/${c.id}`} className="block">
                          {formatDate(c.saleDate)}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[10rem]">
                        <Link href={`/fiado/${c.id}`} className="flex items-center gap-2">
                          <span className="truncate font-semibold">{c.customerName}</span>
                          {c.status === "PAGO" && <Badge variant="success">Quitada</Badge>}
                          {c.status === "PERDA" && <Badge variant="secondary">Perda</Badge>}
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
                        className={cn("text-right font-bold tabular-nums", corDoSaldo(c))}
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
            </Card>

            {/* Celular: os mesmos dados empilhados — no balcão a tela é estreita
                e uma tabela de 8 colunas viraria rolagem lateral. O botão de
                receber desce para uma linha própria: ao lado do saldo, ele
                espremia o nome do cliente em 320px. */}
            <div className="flex flex-col gap-2 md:hidden">
              {contas.map((c) => (
                <Link
                  key={c.id}
                  href={`/fiado/${c.id}`}
                  className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Card
                    className={cn(
                      "flex flex-col gap-3 p-4 motion-safe:transition-colors hover:bg-muted/60",
                      estaVencida(c) && "border-destructive/50 bg-destructive/5",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="block truncate font-semibold">{c.customerName}</span>
                        {(c.status !== "EM_ABERTO" || estaVencida(c) || c.plasticCrateQty > 0) && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {c.status === "PAGO" && <Badge variant="success">Quitada</Badge>}
                            {c.status === "PERDA" && <Badge variant="secondary">Perda</Badge>}
                            {estaVencida(c) && (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="size-3" /> Vencida
                              </Badge>
                            )}
                            {c.plasticCrateQty > 0 && (
                              <Badge variant="secondary">{c.plasticCrateQty} cx</Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        <div className="text-right">
                          <span
                            className={cn("block text-lg font-bold tabular-nums", corDoSaldo(c))}
                          >
                            {formatBRL(c.saldo)}
                          </span>
                          <span className="block text-sm text-muted-foreground tabular-nums">
                            de {formatBRL(c.totalAmount)}
                          </span>
                        </div>
                        <ChevronRight
                          aria-hidden
                          className="mt-1 size-5 shrink-0 text-muted-foreground"
                        />
                      </div>
                    </div>

                    <div className="min-w-0 text-sm">
                      <span className="block truncate">
                        <ProdutosResumo itens={c.itens} />
                      </span>
                      <span className="block text-muted-foreground">
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

                    {c.status === "EM_ABERTO" && (
                      <div className="flex justify-end">
                        <ReceberRapido
                          accountId={c.id}
                          customerName={c.customerName}
                          saldo={Number(c.saldo)}
                        />
                      </div>
                    )}
                  </Card>
                </Link>
              ))}
            </div>

            {ultimaPagina > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                {pagina > 1 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={linkPara({ pagina: pagina - 1 })}>Anterior</Link>
                  </Button>
                ) : (
                  <span />
                )}
                <span className="text-sm text-muted-foreground">
                  Página {pagina} de {ultimaPagina} · {total} conta{total === 1 ? "" : "s"}
                </span>
                {pagina < ultimaPagina ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={linkPara({ pagina: pagina + 1 })}>Próxima</Link>
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
