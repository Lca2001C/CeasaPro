import Link from "next/link";
import { after } from "next/server";
import type { NoticiaTema } from "@prisma/client";
import { Newspaper } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { NoticiasService } from "@/lib/services/noticias.service";
import { CatalogoImagensService } from "@/lib/services/catalogo-imagens.service";
import { ProdutosService } from "@/lib/services/produtos.service";
import { agruparPorPrimeiraPalavra } from "@/lib/cotacoes/nome";
import { familiasCitadas, ilustracaoDaNoticia, TEMAS } from "@/lib/noticias/filtro";
import { NOTICIA_TEMA_LABELS } from "@/lib/labels";
import { describeError, logger } from "@/lib/logger";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { cn } from "@/lib/cn";
import { CartaoDeNoticia } from "./_components/cartao-de-noticia";

export const dynamic = "force-dynamic";

/** Quantas notícias "sobre os seus produtos" sobem para o topo. */
const NO_TOPO = 8;

export default async function CeasaNewsPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string }>;
}) {
  const { tema: rawTema } = await searchParams;
  const tema = (TEMAS as readonly string[]).includes(rawTema ?? "")
    ? (rawTema as NoticiaTema)
    : undefined;
  const { tenantId } = await requireTenant();

  let noticias = await NoticiasService.listar({ tema });

  /*
    Primeira vez do módulo (nenhuma coleta nunca deu certo): coleta AGORA, com
    prazo curto, em vez de mostrar "nada por aqui" a quem acabou de contratar.
    Fora disso, a coleta roda DEPOIS da resposta (`after`) e só se a última
    tiver mais de 2 h — a tela não espera a internet de ninguém.
  */
  if (noticias.length === 0 && (await NoticiasService.primeiraColetaSeNunca())) {
    noticias = await NoticiasService.listar({ tema });
  } else {
    try {
      after(() =>
        NoticiasService.coletarSeVelho().catch((e) =>
          logger.error({ err: describeError(e) }, "Coleta sob demanda do CeasaNews falhou"),
        ),
      );
    } catch {
      // Fora de requisição (teste): sem coleta em segundo plano, a tela segue.
    }
  }

  // "Sobre os seus produtos": a família pela primeira palavra do nome, a mesma
  // régua das Cotações ("Tomate Italiano" → tomate).
  const [nomes, fotos] = await Promise.all([
    ProdutosService.nomesAtivos(tenantId),
    CatalogoImagensService.paraIlustrar(),
  ]);
  const familias = agruparPorPrimeiraPalavra(nomes, (n) => n).map((g) => g.rotulo);
  const citadas = new Map<string, string[]>(
    noticias.map((n) => [n.id, familiasCitadas(`${n.titulo} ${n.resumo}`, familias)]),
  );
  const sobreSeus = noticias.filter((n) => (citadas.get(n.id) ?? []).length > 0).slice(0, NO_TOPO);
  const noTopo = new Set(sobreSeus.map((n) => n.id));
  const demais = noticias.filter((n) => !noTopo.has(n.id));

  // `fotos`: do Banco, para a notícia sem imagem própria (ver `CartaoDeNoticia`).
  const ilustracao = new Map(
    noticias.map((n) => [n.id, n.imagemUrl ? null : ilustracaoDaNoticia(n.titulo, n.resumo, fotos)]),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="CeasaNews"
        description="O que mexe no mercado de hortifruti: CEASAs, preços, clima, frete e safra."
      />

      <nav aria-label="Assuntos" className="flex flex-wrap gap-1.5">
        <ChipDeTema href="/ceasanews" ativo={!tema} rotulo="Tudo" />
        {TEMAS.map((t) => (
          <ChipDeTema
            key={t}
            href={`/ceasanews?tema=${t}`}
            ativo={tema === t}
            rotulo={NOTICIA_TEMA_LABELS[t] ?? t}
          />
        ))}
      </nav>

      {noticias.length === 0 ? (
        <EmptyState
          icon={<Newspaper />}
          title={tema ? "Nenhuma notícia neste assunto" : "Nenhuma notícia por enquanto"}
          description={
            tema
              ? "Nada desse assunto nos últimos 7 dias. Veja as outras em Tudo."
              : "As notícias são buscadas várias vezes por dia. Volte daqui a pouco."
          }
        />
      ) : (
        <>
          {/*
            "Sobre os seus produtos" é uma FAIXA horizontal, como o carrossel de
            vídeos do g1: rola de lado no celular (com encaixe por cartão) e não
            empurra a lista principal para baixo da dobra.
          */}
          {sobreSeus.length > 0 && (
            <section aria-labelledby="sobre-seus" className="flex flex-col gap-3">
              <h2 id="sobre-seus" className="text-lg font-bold">
                Sobre os seus produtos
              </h2>
              {/* No celular a faixa vai de borda a borda (-mx-4) e o cartão
                  seguinte aparece pela metade, avisando que rola; a partir do
                  tablet ela se alinha ao conteúdo e cabem 3, depois 4 inteiros. */}
              <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:mx-0 sm:scroll-px-0 sm:px-0">
                {sobreSeus.map((n) => (
                  <CartaoDeNoticia
                    key={n.id}
                    noticia={n}
                    ilustracao={ilustracao.get(n.id) ?? null}
                    familias={citadas.get(n.id)}
                    className="w-[78vw] max-w-[320px] shrink-0 snap-start sm:w-[calc((100%-1rem)/2)] sm:max-w-none lg:w-[calc((100%-2rem)/3)] xl:w-[calc((100%-3rem)/4)]"
                  />
                ))}
              </div>
            </section>
          )}

          {demais.length > 0 && (
            <section aria-labelledby="mais-noticias" className="flex flex-col gap-3">
              <h2 id="mais-noticias" className="text-lg font-bold">
                {sobreSeus.length > 0 ? "Mais notícias" : "Últimas notícias"}
              </h2>
              {/* Lado a lado: 1 coluna no celular, 2 no tablet, 3 no desktop. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {demais.map((n) => (
                  <CartaoDeNoticia
                    key={n.id}
                    noticia={n}
                    ilustracao={ilustracao.get(n.id) ?? null}
                    familias={citadas.get(n.id)}
                  />
                ))}
              </div>
            </section>
          )}
          <p className="text-center text-[11px] text-muted-foreground">
            Notícias de veículos de terceiros, dos últimos 7 dias. Cada uma abre a matéria no site de
            quem publicou.
          </p>
        </>
      )}
    </div>
  );
}

function ChipDeTema({ href, ativo, rotulo }: { href: string; ativo: boolean; rotulo: string }) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "true" : undefined}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold",
        ativo ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
      )}
    >
      {rotulo}
    </Link>
  );
}
