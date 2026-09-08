import Link from "next/link";
import { AlertTriangle, Link2 } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { CotacoesService, type LinhaDeCotacao } from "@/lib/services/cotacoes.service";
import {
  explicacaoDaCadencia,
  explicacaoSemBoletim,
  frescorDoBoletim,
  rotuloDeFrescor,
} from "@/lib/cotacoes/frescor";
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

  const temVinculo = painel.linhas.some((l) => l.meuProdutoId);
  // Abrir em "Meus produtos" só faz sentido se houver algum: senão a primeira
  // impressão do módulo seria uma lista vazia — o mesmo raciocínio do filtro
  // padrão do estoque.
  const filtro: Filtro = FILTROS.some((f) => f.value === rawFiltro)
    ? (rawFiltro as Filtro)
    : temVinculo
      ? "MEUS"
      : "TODOS";

  const casaComBusca = (l: LinhaDeCotacao) =>
    !busca ||
    l.ceasaProductName.toLowerCase().includes(busca) ||
    (l.meuProdutoNome?.toLowerCase().includes(busca) ?? false);

  /*
    As duas seções da tela.

    Os produtos vinculados vêm SEMPRE primeiro, e não é ordenação estética: a
    pergunta que traz o comerciante aqui é "quanto está o que eu vendo", e a
    resposta não pode estar na página 3 de uma lista de 246 itens que ele não
    vende. É a mesma decisão do destaque de estoque, levada ao layout.
  */
  const meus = painel.linhas.filter((l) => l.meuProdutoId).filter(casaComBusca);
  const outros =
    filtro === "MEUS" ? [] : painel.linhas.filter((l) => !l.meuProdutoId).filter(casaComBusca);
  const nenhum = meus.length === 0 && outros.length === 0;

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
        </Card>
      ) : (
        <Card className="border-warning/50 bg-warning/5 p-3">
          <p className="text-sm font-medium">Ainda não recebemos boletim desta central.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {explicacaoSemBoletim(painel.central.automatica)}
          </p>
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
                ? "Vincule seus produtos às cotações para vê-los aqui."
                : "O boletim desta central ainda não trouxe produtos."
          }
        />
      ) : (
        <>
          {meus.length > 0 && (
            <section className="flex flex-col gap-2">
              <SecaoTitulo texto="Produtos que você vende" quantidade={meus.length} />
              <Grade linhas={meus} />
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

function Grade({ linhas }: { linhas: LinhaDeCotacao[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {linhas.map((l) => (
        <CartaoDeCotacao key={`${l.ceasaProductId}-${l.unit}`} linha={l} />
      ))}
    </div>
  );
}
