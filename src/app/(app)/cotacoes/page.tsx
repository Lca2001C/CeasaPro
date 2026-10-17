import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Link2, Send } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import {
  CotacoesService,
  type LinhaDeCotacao,
  type MeuProdutoNaCotacao,
} from "@/lib/services/cotacoes.service";
import {
  explicacaoDaCadencia,
  explicacaoSemBoletim,
  frescorDoBoletim,
  rotuloDeFrescor,
} from "@/lib/cotacoes/frescor";
import { casaPelaPrimeiraPalavra, primeiraPalavra } from "@/lib/cotacoes/nome";
import { formatDateOnly } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { BuscaCotacoes } from "./_components/busca-cotacoes";
import { EscolherCentral } from "./_components/escolher-central";
import { CartaoDeCotacao } from "./_components/cartao-de-cotacao";
import { CartaoMeuProduto } from "./_components/cartao-meu-produto";

export const dynamic = "force-dynamic";

const FILTROS = [
  { value: "MEUS", label: "Meus produtos" },
  { value: "TODOS", label: "Todos" },
] as const;

type Filtro = (typeof FILTROS)[number]["value"];

export default async function CotacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; q?: string }>;
}) {
  const { filtro: rawFiltro, q } = await searchParams;
  const busca = q?.trim().toLowerCase() || "";

  const { tenantId } = await requireTenant();
  const painel = await CotacoesService.getPainel(tenantId);
  // Depois do painel, e não em paralelo: `getPainel` grava os vínculos
  // automáticos de nome idêntico, e esta lista precisa enxergá-los.
  const meusProdutos = painel.central ? await CotacoesService.getMeusProdutos(tenantId) : [];

  /*
    Quem tem central e NENHUM vínculo vai para a tela de partida.

    É o estado de quem acabou de contratar o módulo, ou de quem escolheu a praça
    no cadastro: a grade mostraria duzentas e quarenta linhas de produtos que ele
    não vende, sem nada indicando que o trabalho útil é dizer quais são os dele.
    Com um vínculo já feito, a grade é o destino certo e este desvio não acontece
    mais.

    Só com central: sem ela a própria grade já virou o formulário de escolha
    (abaixo), que é a mesma pergunta em menos cliques.
  */
  const temPorPalavra = painel.linhas.some((l) => l.vinculo === "palavra");
  if (painel.central && !painel.temVinculo && !temPorPalavra && painel.semVinculo.length > 0) {
    redirect("/cotacoes/comecar");
  }

  // Sem central escolhida não há o que mostrar, e a única coisa a fazer é
  // escolher. A tela vira esse formulário em vez de uma lista vazia.
  if (!painel.central) {
    const centrais = await CotacoesService.listarCentrais();
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Cotações" description="Preços do boletim da sua central do CEASA." />
        <Card className="p-4">
          <p className="mb-4 text-sm text-muted-foreground">
            Escolha em qual central você compra. Os preços mostrados aqui passam a ser os
            do boletim que ela publica.
          </p>
          <EscolherCentral centrais={centrais} atual={null} autoFoco />
        </Card>
      </div>
    );
  }

  /*
    Abrir em "Meus produtos" só faz sentido se houver algum: senão a primeira
    impressão do módulo seria uma lista vazia — o mesmo raciocínio do filtro
    padrão do estoque.

    `painel.temVinculo` vem da contagem de VÍNCULOS, e antes esta linha o derivava
    das linhas do boletim (`linhas.some(l => l.meuProdutoId)`). A diferença
    aparece no dia em que a embalagem vinculada não sai no boletim: a tela
    concluía "esta empresa nunca vinculou nada", abria em "Todos" e a seção verde
    desaparecia inteira — para quem tinha vinculado tudo.
  */
  const filtro: Filtro = FILTROS.some((f) => f.value === rawFiltro)
    ? (rawFiltro as Filtro)
    : meusProdutos.length > 0
      ? "MEUS"
      : "TODOS";

  // Pela PRIMEIRA palavra: "tomate" traz todos os tomates do boletim, e
  // "salada" não traz "TOMATE SALADA" — é a família que a pessoa procura.
  const casaComBusca = (l: LinhaDeCotacao) =>
    !busca ||
    casaPelaPrimeiraPalavra(l.ceasaProductName, busca) ||
    (l.meuProdutoNome !== null && casaPelaPrimeiraPalavra(l.meuProdutoNome, busca));
  const familiaBuscada = primeiraPalavra(busca);

  /*
    As três seções da tela.

    1. "Produtos que você vende": TODO produto ativo do cliente, do que mais
       vende para o que menos vende (30 dias, o critério do PDV). A pergunta
       que traz o comerciante aqui é "quanto está o que eu vendo", e a
       resposta não pode estar na página 3 de uma lista de 246 itens — nem
       depender de o produto ter saído no boletim de hoje: quem não saiu
       aparece com o último preço e a data, e quem não tem vínculo aparece
       com o caminho para vincular.
    2. "Parecidos com os seus": a família pela primeira palavra, sem vínculo
       gravado ("TOMATE SALADA" para quem vende "Tomate Italiano").
    3. "Outros produtos da CEASA": o resto do boletim, só em "Todos". A linha do
       mesmo item em OUTRA embalagem fica aqui, com a marca "sua embalagem é X"
       — se subisse, a caixa e o quilo competiriam na seção do topo.
  */
  const chave = (l: { ceasaProductId: string; unit: string }) => `${l.ceasaProductId}|${l.unit}`;
  const linhasDoProduto = (m: MeuProdutoNaCotacao): LinhaDeCotacao[] =>
    m.vinculo
      ? painel.linhas
          .filter(
            (l) =>
              l.ceasaProductId === m.vinculo!.ceasaProductId &&
              (m.vinculo!.unit === null || l.unit === m.vinculo!.unit),
          )
          // A linha é DESTE produto: dois produtos no mesmo item do boletim
          // mostram, cada um, o seu nome e o seu saldo.
          .map((l) => ({
            ...l,
            vinculo: "exato" as const,
            meuProdutoId: m.produtoId,
            meuProdutoNome: m.nome,
            meuSaldo: m.saldo,
          }))
      : [];
  const usadas = new Set(meusProdutos.flatMap((m) => linhasDoProduto(m).map(chave)));
  const casaProduto = (m: MeuProdutoNaCotacao) =>
    !busca ||
    casaPelaPrimeiraPalavra(m.nome, busca) ||
    (m.vinculo !== null && casaPelaPrimeiraPalavra(m.vinculo.ceasaProductName, busca));
  const meus = meusProdutos
    .filter(casaProduto)
    .map((m) => ({ produto: m, linhas: linhasDoProduto(m) }));
  const parecidos = painel.linhas
    .filter((l) => l.vinculo === "palavra" && !usadas.has(chave(l)))
    .filter(casaComBusca);
  const outros =
    filtro === "MEUS"
      ? []
      : painel.linhas
          .filter((l) => l.vinculo !== "palavra" && !usadas.has(chave(l)))
          .filter(casaComBusca);
  const nenhum = meus.length === 0 && parecidos.length === 0 && outros.length === 0;

  const frescor = frescorDoBoletim(
    painel.quoteDate,
    new Date(),
    painel.central.maxDiasSemBoletim,
  );
  const rotulo = rotuloDeFrescor(frescor);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Cotações"
        description={`${painel.central.name} — ${painel.central.city}/${painel.central.uf}`}
      />

      {/*
        A data do BOLETIM, não a do fetch, e em destaque. Sem isso o cliente
        conclui que está olhando o preço de agora e repassa preço velho achando
        que é novo — o único jeito de este módulo causar prejuízo. A frase abaixo
        dela diz POR QUE o dado tem a idade que tem, e isso depende de a central
        ter busca automática (ver `explicacaoDaCadencia`).
      */}
      {painel.quoteDate ? (
        <Card
          className={cn("p-3", frescor.nivel === "defasado" && "border-warning/50 bg-warning/5")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              Boletim de {formatDateOnly(painel.quoteDate)}
            </span>
            {rotulo && (
              <Badge variant={frescor.nivel === "defasado" ? "warning" : "secondary"}>
                {frescor.nivel === "defasado" && <AlertTriangle className="size-3" />}
                {rotulo}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {explicacaoDaCadencia(painel.central.automatica)}
          </p>
          <EnviarBoletimCta automatica={painel.central.automatica} />
        </Card>
      ) : (
        <Card className="border-warning/50 bg-warning/5 p-3">
          <p className="text-sm font-medium">Ainda não recebemos boletim desta central.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {explicacaoSemBoletim(painel.central.automatica)}
          </p>
          <EnviarBoletimCta automatica={painel.central.automatica} />
        </Card>
      )}

      {painel.semVinculo.length > 0 && (
        <Card className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <strong>{painel.semVinculo.length}</strong>{" "}
              {painel.semVinculo.length === 1
                ? "produto seu ainda não tem cotação"
                : "produtos seus ainda não têm cotação"}
              .
              {/*
                O número de nomes idênticos diz se o trabalho é de um clique ou
                de uma tarde — a diferença entre abrir a tela agora e deixar para
                depois para sempre. Sobe sozinho no dia em que a praça passa a
                publicar um item que casa com algo que o cliente vende.
              */}
              {painel.semVinculoComNomeIdentico > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  {painel.semVinculoComNomeIdentico === 1
                    ? "1 deles já tem o nome exato no boletim de hoje."
                    : `${painel.semVinculoComNomeIdentico} deles já têm o nome exato no boletim de hoje.`}
                </span>
              )}
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/cotacoes/vincular">
                <Link2 className="size-4" />
                Vincular
              </Link>
            </Button>
          </div>
        </Card>
      )}

      {/*
        "Não saiu neste boletim" e "dois produtos no mesmo item" eram cartões de
        aviso aqui. Agora cada produto tem o próprio cartão na seção do topo —
        com o último preço e a data, ou com o seu nome na linha compartilhada —
        e nada some da tela calado.
      */}
      {painel.familias.length > 0 && (
        <nav aria-label="Seus produtos" className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Seus produtos</span>
          <div className="flex flex-wrap gap-1.5">
            {painel.familias.map((f) => {
              const ativa = familiaBuscada === f.chave;
              const q = ativa ? "" : `&q=${encodeURIComponent(f.chave)}`;
              return (
                <Link
                  key={f.chave}
                  href={`/cotacoes?filtro=${filtro}${q}`}
                  aria-current={ativa ? "true" : undefined}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-semibold",
                    ativa
                      ? "border-success bg-success text-success-foreground"
                      : "bg-background hover:bg-muted",
                  )}
                >
                  {f.rotulo}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      <BuscaCotacoes />

      <div className="flex gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant={filtro === f.value ? "default" : "outline"}
          >
            <Link
              href={`/cotacoes?filtro=${f.value}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`}
            >
              {f.label}
            </Link>
          </Button>
        ))}
      </div>

      {nenhum ? (
        <EmptyState
          title={busca ? "Nada encontrado" : "Nenhuma cotação"}
          description={
            busca
              ? "Nenhum produto do boletim casa com essa busca."
              : filtro === "MEUS"
                ? "Você ainda não tem produtos ativos. Veja em Todos."
                : "O boletim desta central ainda não trouxe produtos."
          }
        />
      ) : (
        <>
          {meus.length > 0 && (
            <section className="flex flex-col gap-2">
              <SecaoTitulo texto="Produtos que você vende" quantidade={meus.length} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {meus.map(({ produto, linhas }) =>
                  linhas.length > 0 ? (
                    linhas.map((l) => (
                      <CartaoDeCotacao key={`${produto.produtoId}-${chave(l)}`} linha={l} />
                    ))
                  ) : (
                    <CartaoMeuProduto key={produto.produtoId} produto={produto} />
                  ),
                )}
              </div>
            </section>
          )}

          {parecidos.length > 0 && (
            <section className="flex flex-col gap-2">
              <SecaoTitulo texto="Parecidos com os seus" quantidade={parecidos.length} />
              <Grade linhas={parecidos} />
            </section>
          )}

          {outros.length > 0 && (
            <section className="flex flex-col gap-2">
              <SecaoTitulo texto="Outros produtos da CEASA" quantidade={outros.length} />
              <Grade linhas={outros} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SecaoTitulo({ texto, quantidade }: { texto: string; quantidade: number }) {
  return (
    <h2 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {texto} <span className="tabular-nums">({quantidade})</span>
    </h2>
  );
}

/**
 * O convite a enviar o boletim — só onde não há quem busque.
 *
 * Fica junto da explicação da cadência, que é onde a pessoa está lendo "esta
 * praça não publica de forma automática" e pensando "e agora?". Em praça com
 * raspador não aparece: os dois caminhos gravariam a mesma data, a gravação
 * sobrescreve, e o preço passaria a mudar conforme quem chegou por último.
 */
function EnviarBoletimCta({ automatica }: { automatica: boolean }) {
  if (automatica) return null;
  return (
    <div className="mt-2">
      <Button asChild size="sm" variant="outline">
        <Link href="/cotacoes/enviar-boletim">
          <Send className="size-4" />
          Enviar o boletim desta praça
        </Link>
      </Button>
    </div>
  );
}

function Grade({ linhas }: { linhas: LinhaDeCotacao[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {linhas.map((l) => (
        <CartaoDeCotacao key={`${l.ceasaProductId}-${l.unit}`} linha={l} />
      ))}
    </div>
  );
}
