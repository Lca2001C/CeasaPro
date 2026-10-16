import Link from "next/link";
import type { ReactNode } from "react";
import { OfflineSync } from "@/components/pwa/offline-sync";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  HandCoins,
  LayoutDashboard,
  Package,
  Percent,
  ReceiptText,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { DashboardService, type DashboardProductRow } from "@/lib/services/dashboard.service";
import { PainelFinanceiroService } from "@/lib/services/painel-financeiro.service";
import { AvisosService } from "@/lib/services/avisos.service";
import { ContasPagarService } from "@/lib/services/contas-pagar.service";
import { DespesasService } from "@/lib/services/despesas.service";
import { ContasAPagarCard } from "@/components/data/contas-a-pagar-card";
import { CompletarCadastroCard } from "@/components/data/completar-cadastro-card";
import { CotacoesInteresseCard } from "@/components/data/cotacoes-interesse-card";
import { CotacoesAlertasService } from "@/lib/services/cotacoes-alertas.service";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { isModuleEnabled } from "@/lib/plan/modules";
import { ConfigService } from "@/lib/services/config.service";
import { startOfDayTz } from "@/lib/tz";
import { formatBRL, formatDate, formatQty, valorExibivel } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { StatCard } from "@/components/data/stat-card";
import {
  BarrasHorizontais,
  CartaoGrafico,
  COR_SERIE,
  ColunasPorDia,
  ColunasPorMes,
  nomeDoMes,
} from "@/components/financeiro/graficos";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConviteTour } from "@/components/tour/convite-tour";
import { CardDeResumo } from "@/components/ui/card-de-resumo";
import { ListaDeAcoes, LinhaDeAcao } from "@/components/ui/linha-de-acao";

export const dynamic = "force-dynamic";

type Aba = "geral" | "financeiro";

/**
 * Início em duas abas, pela URL (`?aba=financeiro`):
 *
 * - **Visão Geral**: o balcão — avisos, contas que vencem, os quatro números do
 *   dia e os produtos (mais vendidos, prejuízo, estoque parado).
 * - **Financeiro**: o fechamento — vendas, compras, contas, lucro e margem do
 *   mês, com gráficos.
 *
 * Por URL, e não por estado: a página continua Server Component, o link é
 * compartilhável e o botão Voltar do celular volta de aba. A consulta da série
 * financeira só roda quando a aba é aberta.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { aba: abaUrl } = await searchParams;
  const aba: Aba = abaUrl === "financeiro" ? "financeiro" : "geral";
  const { tenantId, session } = await requireTenant();
  const temCotacoes = isModuleEnabled(session.modules, "cotacoes");
  const ehGeral = aba === "geral";
  const [s, avisos, contas, proximas, cadastro, cotacoes, comparacao, financeiro] =
    await Promise.all([
      DashboardService.getSummary(tenantId, session.modules),
      AvisosService.get(tenantId, session.modules),
      // "Tudo a pagar": despesas + higienização somadas, porque o cliente pensa
      // em "quanto tenho que pagar", não em módulos.
      ContasPagarService.get(tenantId, session.modules),
      DespesasService.proximasContas(tenantId),
      ConfigService.pendenciasDoCadastro(tenantId),
      /*
        Cotações é módulo PAGO e o Início não é protegido por rota — o gate tem de
        ser aqui, como em `ContasPagarService`. Sem ele, quem não contratou veria
        preços no painel e cairia no paywall ao tocar. `isModuleEnabled` é
        fail-closed (sem a lista, responde não), então o custo do esquecimento
        seria mostrar demais, nunca de menos.
      */
      temCotacoes && ehGeral ? CotacoesAlertasService.getInteresses(tenantId) : null,
      // A última compra contra o boletim. Mesmo gate, mesma razão.
      temCotacoes && ehGeral ? CotacoesService.comprasAcimaDoBoletim(tenantId) : null,
      ehGeral ? null : PainelFinanceiroService.get(tenantId),
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

      {/*
        Cadastro incompleto vem ANTES do convite ao tour: sem nome de empresa o
        sistema mostra "Minha empresa" no topo e no comprovante da mensalidade,
        e isso é mais urgente que aprender a usar as telas.
      */}
      {cadastro.mostrar && <CompletarCadastroCard faltando={cadastro.faltando} />}

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

      {/* As duas abas. Visual de aba, mas são links: cada uma é uma URL. */}
      <nav
        aria-label="Seções do Início"
        className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/60 p-1 sm:inline-grid sm:w-auto sm:self-start"
      >
        <AbaLink href="/dashboard" ativa={ehGeral} icone={<LayoutDashboard />}>
          Visão Geral
        </AbaLink>
        <AbaLink
          href="/dashboard?aba=financeiro"
          ativa={!ehGeral}
          icone={<BarChart3 />}
          tour="dashboard-detalhes"
        >
          Financeiro
        </AbaLink>
      </nav>

      {/* A ação principal fica no TOPO: quem abre o app no balcão quer vender,
          não rolar doze números até achar o botão. Escritos e coloridos — cada
          cor é uma ação, a mesma em todas as telas. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button
          asChild
          size="lg"
          variant="success"
          className="h-14 w-full text-base shadow-md [&_svg]:size-5"
          data-tour="dashboard-vender"
        >
          <Link href="/vendas/nova">
            <ShoppingCart /> Nova venda
          </Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="info"
          className="h-14 w-full text-base shadow-md [&_svg]:size-5"
        >
          <Link href="/estoque?novo=1">
            <Boxes /> Novo produto
          </Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="violet"
          className="h-14 w-full text-base shadow-md [&_svg]:size-5"
        >
          <Link href="/fiado/novo">
            <HandCoins /> Novo fiado
          </Link>
        </Button>
      </div>

      {ehGeral ? (
        <>
          {/*
            Os quatro números do dia a dia. "Hoje vendi" é o destaque — o número
            que o dono abre o app para ver —; os outros três abrem a tela deles.
            O fechamento do mês está na aba Financeiro.
          */}
          <div className="grid gap-3 sm:grid-cols-3" data-tour="dashboard-numeros">
            <CardDeResumo
              destaque
              className="sm:col-span-3"
              rotulo="Hoje vendi"
              valor={formatBRL(s.hojeVendi)}
              dica={`No mês: ${valorExibivel(formatBRL(s.mesVendi))}`}
              icone={<ShoppingCart />}
              href="/vendas"
            />
            <CardDeResumo
              rotulo="Clientes me devem"
              valor={formatBRL(s.aReceber)}
              dica="Fiado a receber"
              icone={<HandCoins />}
              tom="warning"
              tomDoValor={s.aReceber.greaterThan(0) ? "warning" : undefined}
              href="/fiado"
            />
            <CardDeResumo
              rotulo="Tenho em estoque"
              valor={formatBRL(s.estoqueValor)}
              dica="Valor da mercadoria"
              icone={<Package />}
              href="/estoque"
            />
            <CardDeResumo
              rotulo="Sobrou no mês"
              valor={formatBRL(s.lucroMes)}
              dica="Lucro líquido"
              icone={<TrendingUp />}
              tom={lucroTone}
              tomDoValor={lucroTone}
              href="/dashboard?aba=financeiro"
            />
          </div>

          <Atalhos temCotacoes={temCotacoes} />

          {avisos.length > 0 && (
            <ListaDeAcoes titulo="Precisa de atenção">
              {avisos.map((aviso) => (
                <LinhaDeAcao
                  key={aviso.tipo}
                  href={aviso.href}
                  icone={<AlertTriangle />}
                  tom="warning"
                  titulo={aviso.label}
                  // Aviso sem dinheiro (cotação) não ganha valor: `formatBRL(null)`
                  // escreveria "R$ 0,00", que leria como "não tem nada a pagar".
                  complemento={
                    aviso.total !== null ? valorExibivel(formatBRL(aviso.total)) : undefined
                  }
                />
              ))}
            </ListaDeAcoes>
          )}

          {/* Contas a pagar reunidas: despesas + higienização, com as três mais
              próximas clicáveis. Responde "o que eu preciso resolver hoje?". */}
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

          {/* Depois dos números do dia: é referência para a compra de amanhã —
              o comerciante sai para o CEASA de madrugada, e escondê-la atrás de
              um toque significa, na prática, que ele vai sem saber. */}
          {cotacoes && cotacoes.itens.length > 0 && (
            <CotacoesInteresseCard
              interesses={cotacoes}
              agora={new Date()}
              comparacao={comparacao ?? undefined}
            />
          )}

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
            <EstoqueParado linhas={s.estoqueParado} cotacoes={cotacoes} />
          </div>
        </>
      ) : (
        <Financeiro s={s} financeiro={financeiro!} lucroTone={lucroTone} margemTone={margemTone} />
      )}
    </div>
  );
}

function AbaLink({
  href,
  ativa,
  icone,
  tour,
  children,
}: {
  href: string;
  ativa: boolean;
  icone: ReactNode;
  tour?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={ativa ? "page" : undefined}
      data-tour={tour}
      className={cn(
        "flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold transition-colors [&_svg]:size-4",
        ativa
          ? "bg-background text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
    >
      {icone}
      {children}
    </Link>
  );
}

type Resumo = Awaited<ReturnType<typeof DashboardService.getSummary>>;
type DadosFinanceiros = Awaited<ReturnType<typeof PainelFinanceiroService.get>>;

/** A aba Financeiro: os números do mês e os gráficos que os explicam. */
function Financeiro({
  s,
  financeiro,
  lucroTone,
  margemTone,
}: {
  s: Resumo;
  financeiro: DadosFinanceiros;
  lucroTone: "success" | "destructive";
  margemTone: "success" | "destructive";
}) {
  const prejuizo = s.lucroMes.isNegative();
  const ultimoMes = financeiro.meses.at(-1);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Vendi no mês"
          value={formatBRL(s.mesVendi)}
          icon={<WalletCards className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Vendi na semana"
          value={formatBRL(s.semanaVendi)}
          icon={<TrendingUp className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Sobrou no mês"
          value={formatBRL(s.lucroMes)}
          hint="Lucro líquido"
          icon={<TrendingUp className="size-4" />}
          tone={lucroTone}
        />
        <StatCard
          label="Sobrou em %"
          value={`${formatQty(s.margemLiquidaMes)}%`}
          hint="Margem líquida"
          icon={<Percent className="size-4" />}
          tone={margemTone}
        />
        <StatCard
          label="Comprei no mês"
          value={formatBRL(s.totalCompradoMes)}
          icon={<ReceiptText className="size-4" />}
        />
        <StatCard
          label="Ganhei nas vendas"
          value={formatBRL(s.lucroBrutoMes)}
          hint="Lucro bruto — antes das contas"
          icon={<TrendingUp className="size-4" />}
          tone={s.lucroBrutoMes.isNegative() ? "destructive" : "success"}
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

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Do que entrou ao que sobrou, nos mesmos números dos cartões. */}
        <CartaoGrafico
          titulo="Resultado do mês"
          subtitulo="Do que você vendeu ao que sobrou"
          destaque={
            <span className={prejuizo ? "text-destructive" : "text-success"}>
              {formatBRL(s.lucroMes)}
            </span>
          }
          tabela={{
            colunas: ["Linha", "Valor"],
            linhas: [
              ["Vendi", Number(s.mesVendi)],
              ["Custo da mercadoria vendida", -Number(s.cmvMes)],
              ["Contas do mês", -Number(s.despesasLucroMes)],
              [prejuizo ? "Prejuízo" : "Sobrou", Number(s.lucroMes)],
            ],
          }}
        >
          <BarrasHorizontais
            mostrarPercentual={false}
            itens={[
              { rotulo: "Vendi", valor: Number(s.mesVendi), cor: COR_SERIE.vendas },
              {
                rotulo: "Custo da mercadoria vendida",
                valor: Number(s.cmvMes),
                cor: COR_SERIE.compras,
                prefixo: "− ",
              },
              {
                rotulo: "Contas do mês",
                valor: Number(s.despesasLucroMes),
                cor: COR_SERIE.contas,
                prefixo: "− ",
              },
              {
                rotulo: prejuizo ? "Prejuízo" : "Sobrou",
                valor: Number(s.lucroMes),
                cor: prejuizo ? "bg-destructive" : "bg-success",
                prefixo: prejuizo ? "− " : "= ",
              },
            ]}
          />
        </CartaoGrafico>

        <CartaoGrafico
          titulo="Vendas dos últimos 30 dias"
          subtitulo="Toque numa barra para ver o dia"
          destaque={formatBRL(s.chart.reduce((a, d) => a + d.total, 0))}
          tabela={{
            colunas: ["Dia", "Vendas"],
            linhas: s.chart
              .filter((d) => d.total > 0)
              .map((d) => [formatDate(new Date(d.date + "T12:00:00")), d.total]),
          }}
        >
          <ColunasPorDia dados={s.chart} />
        </CartaoGrafico>
      </div>

      <CartaoGrafico
        titulo="Últimos 6 meses"
        subtitulo="Quanto vendeu, quanto comprou de mercadoria e quanto pagou de contas"
        destaque={
          ultimoMes ? (
            <span className="text-sm font-medium text-muted-foreground">
              até {nomeDoMes(ultimoMes.mes)}
            </span>
          ) : undefined
        }
        tabela={{
          colunas: ["Mês", "Vendas", "Compras", "Contas"],
          linhas: financeiro.meses.map((m) => [nomeDoMes(m.mes), m.vendas, m.compras, m.contas]),
        }}
      >
        <ColunasPorMes meses={financeiro.meses} />
      </CartaoGrafico>

      <div className="grid gap-3 lg:grid-cols-2">
        <CartaoGrafico titulo="Como recebi no mês" subtitulo="Vendas por forma de pagamento">
          {financeiro.formasDePagamento.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma venda no mês ainda.</p>
          ) : (
            <BarrasHorizontais
              cor={COR_SERIE.vendas}
              itens={financeiro.formasDePagamento.map((f) => ({
                rotulo: PAYMENT_METHOD_LABELS[f.chave] ?? f.chave,
                valor: f.total,
              }))}
            />
          )}
        </CartaoGrafico>

        <CartaoGrafico
          titulo="Para onde foram as contas"
          subtitulo="Contas do mês por categoria (sem as compras de mercadoria)"
        >
          {financeiro.contasPorCategoria.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta lançada no mês.</p>
          ) : (
            <BarrasHorizontais
              cor={COR_SERIE.contas}
              itens={financeiro.contasPorCategoria.map((c) => ({
                rotulo: c.chave,
                valor: c.total,
              }))}
            />
          )}
        </CartaoGrafico>
      </div>
    </>
  );
}

/**
 * Atalhos em pílulas, com rolagem horizontal POR DENTRO — no celular a fila
 * passa da largura da tela, e quem rola é ela, não a página. As três ações
 * principais (venda, produto, fiado) ficam nos botões grandes acima; aqui vão
 * as do dia a dia que antes exigiam abrir o menu.
 */
function Atalhos({ temCotacoes }: { temCotacoes: boolean }) {
  const atalhos = [
    { href: "/estoque/compra", rotulo: "Registrar compra", icone: ShoppingBag },
    { href: "/fiado", rotulo: "Receber fiado", icone: HandCoins },
    { href: "/despesas/nova", rotulo: "Nova despesa", icone: ReceiptText },
    { href: "/estoque/ajuste", rotulo: "Ajuste de estoque", icone: SlidersHorizontal },
    ...(temCotacoes ? [{ href: "/cotacoes", rotulo: "Cotações", icone: TrendingUp }] : []),
    { href: "/relatorios", rotulo: "Relatórios", icone: BarChart3 },
  ];
  return (
    // No desktop a fila cabe e quebra linha; a rolagem é só do celular.
    <nav
      aria-label="Atalhos"
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:overflow-visible md:px-0"
    >
      <ul className="flex w-max gap-2 py-1 md:w-auto md:flex-wrap">
        {atalhos.map(({ href, rotulo, icone: Icone }) => (
          <li key={href}>
            <Link
              href={href}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border/60 bg-card px-4 text-sm font-semibold text-card-foreground shadow-suave outline-none motion-safe:transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icone aria-hidden className="size-4 text-primary" />
              {rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Quanto o boletim CAIU para este produto do cliente, ou `null`.
 *
 * `null` cobre três casos que são o mesmo para a tela: o produto não está
 * vinculado, o módulo não foi contratado, ou o preço não caiu. Só queda
 * interessa aqui — estoque parado com preço subindo é boa notícia, e não precisa
 * de linha nenhuma avisando.
 *
 * O limiar existe pela mesma razão de `LIMIAR_DE_ESTABILIDADE` em `variacao.ts`:
 * o boletim publica centavos, e "caiu 0,4%" ao lado de "hora de queimar" ensina
 * a ignorar o aviso.
 */
const QUEDA_QUE_INTERESSA = 5;

type Interesses = Awaited<ReturnType<typeof CotacoesAlertasService.getInteresses>> | null;

function quedaDoBoletim(productId: string, cotacoes: Interesses): number | null {
  if (!cotacoes) return null;
  const item = cotacoes.itens.find((i) => i.meuProdutoId === productId);
  if (!item || item.variacao === null) return null;
  return item.variacao <= -QUEDA_QUE_INTERESSA ? item.variacao : null;
}

function EstoqueParado({
  linhas,
  cotacoes,
}: {
  linhas: Resumo["estoqueParado"];
  cotacoes: Interesses;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Boxes className="size-4" />
          Estoque parado
        </div>
        {linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum produto parado com saldo.</p>
        ) : (
          <div className="flex flex-col divide-y">
            {linhas.map((row) => {
              const queda = quedaDoBoletim(row.productId, cotacoes);
              return (
                <div key={row.productId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Último movimento: {formatDate(row.lastMovementAt)}
                    </p>
                    {/*
                      Estoque parado E preço caindo no boletim: é a hora de
                      queimar. A FRASE carrega o sentido, não a cor — na tela de
                      cotações alta é vermelho (é o preço que o dono PAGA); para
                      estoque que ele já tem na mão, a leitura se inverte.
                    */}
                    {queda !== null && (
                      <p className="text-xs text-warning">
                        Boletim caiu{" "}
                        {Math.abs(queda).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% —
                        pode ser hora de queimar
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatQty(row.quantity)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
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
