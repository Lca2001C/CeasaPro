import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CircleHelp, Lightbulb, Lock, TriangleAlert } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { OPTIONAL_MODULES, ALL_OPTIONAL_KEYS, isModuleEnabled } from "@/lib/plan/modules";
import { PageHeader } from "@/components/data/page-header";
import { SecaoRecolhivel } from "@/components/data/secao-recolhivel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AREAS, PRIMEIROS_PASSOS, DUVIDAS } from "./_conteudo";

export const metadata: Metadata = {
  title: "Como usar o CeasaPro",
  description: "Guia de uso do sistema, ajustado ao seu plano.",
};

// Lê os módulos da sessão a cada acesso: o guia precisa refletir o plano ATUAL.
// Renderizada por requisição também por causa do nonce do CSP (ver `src/proxy.ts`).
export const dynamic = "force-dynamic";

/**
 * Guia de uso, ajustado ao plano do cliente.
 *
 * Duas decisões que definem a tela:
 *
 * 1. **Mostra o que o cliente TEM.** As áreas de módulo opcional só aparecem se o
 *    plano incluir o módulo — explicar em detalhe uma tela que a pessoa não
 *    consegue abrir é fazer perder tempo. O que não está no plano vai para um
 *    bloco curto no fim, nomeado e com link para "Meu plano": esconder por
 *    completo faria o cliente concluir que o recurso não existe.
 *
 * 2. **Nada de JavaScript.** Server Component com `<details>` nativo
 *    (`SecaoRecolhivel`): o guia é o que a pessoa abre justamente quando algo
 *    não está funcionando, muitas vezes com conexão ruim no box. Ele precisa
 *    abrir e fechar antes de qualquer script carregar.
 */
export default async function AjudaPage() {
  const { session } = await requireTenant();
  const modules = session.modules;

  // Áreas do núcleo (sem `modulo`) + as dos módulos que o plano inclui.
  const areasVisiveis = AREAS.filter(
    (a) => !a.modulo || isModuleEnabled(modules, a.modulo),
  );
  const modulosDeFora = ALL_OPTIONAL_KEYS.filter((k) => !isModuleEnabled(modules, k));

  return (
    <div>
      <PageHeader
        title="Como usar o CeasaPro"
        description="Guia rápido de cada tela, ajustado ao seu plano."
      />

      {/* ─── Para que serve ─── */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-2 pt-6 text-sm leading-relaxed">
          <p>
            O CeasaPro guarda o movimento do seu box: o que você compra, o que vende,
            quem te deve e o que sai do caixa. A ideia é simples — se a compra e a venda
            estiverem lançadas, todo o resto (estoque, lucro, fiado, relatórios) sai
            calculado, sem você somar nada à mão.
          </p>
          <p className="text-muted-foreground">
            Este guia mostra só as telas que o seu plano inclui. Leva uns cinco minutos
            de leitura.
          </p>
        </CardContent>
      </Card>

      {/* ─── Primeiros passos ─── */}
      <h2 className="mb-2 mt-6 text-base font-semibold">Comece por aqui</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Nesta ordem. O estoque começa vazio, então a compra tem de vir antes da venda.
      </p>
      <div className="mb-6 flex flex-col gap-2">
        {PRIMEIROS_PASSOS.map((p) => (
          <Card key={p.titulo}>
            <CardContent className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">{p.titulo}</p>
                <p className="text-sm text-muted-foreground">{p.texto}</p>
              </div>
              <Button asChild variant="ghost" size="icon" aria-label={`Ir para ${p.titulo}`}>
                <Link href={p.href}>
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Tela por tela ─── */}
      <h2 className="mb-2 mt-6 text-base font-semibold">Tela por tela</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Toque para abrir. Onde houver &quot;Atenção&quot;, é uma regra do sistema que
        costuma pegar de surpresa.
      </p>
      <div className="flex flex-col gap-2">
        {areasVisiveis.map((a) => (
          <SecaoRecolhivel key={a.href} titulo={a.titulo} descricao={a.resumo}>
            <div className="flex flex-col gap-3 text-sm">
              <ol className="flex flex-col gap-1.5">
                {a.comoUsar.map((passo, i) => (
                  <li key={passo} className="flex gap-2">
                    <span className="shrink-0 font-medium text-muted-foreground">
                      {i + 1}.
                    </span>
                    <span>{passo}</span>
                  </li>
                ))}
              </ol>

              {a.atencao && (
                <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p className="leading-relaxed">
                    <span className="font-medium">Atenção: </span>
                    {a.atencao}
                  </p>
                </div>
              )}

              <Button asChild variant="outline" size="sm" className="self-start">
                <Link href={a.href}>
                  Abrir {a.titulo} <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </SecaoRecolhivel>
        ))}
      </div>

      {/* ─── Recursos fora do plano ─── */}
      {modulosDeFora.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-base font-semibold">Não incluído no seu plano</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Existem no CeasaPro, mas o seu plano atual não libera. Ficam listados aqui
            para você saber que existem.
          </p>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {modulosDeFora.map((k) => (
                <div key={k} className="flex gap-2 text-sm">
                  <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p>
                    <span className="font-medium">{OPTIONAL_MODULES[k].label}</span>
                    {" — "}
                    <span className="text-muted-foreground">
                      {OPTIONAL_MODULES[k].description}
                    </span>
                  </p>
                </div>
              ))}
              <Button asChild size="sm" className="self-start">
                <Link href="/plano">Ver planos</Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* ─── Dúvidas ─── */}
      <h2 className="mb-2 mt-8 text-base font-semibold">Dúvidas comuns</h2>
      <div className="flex flex-col gap-2">
        {DUVIDAS.map((d) => (
          <SecaoRecolhivel key={d.pergunta} titulo={d.pergunta}>
            <p className="text-sm leading-relaxed">{d.resposta}</p>
          </SecaoRecolhivel>
        ))}
      </div>

      {/* ─── Ainda com dúvida ─── */}
      <Card className="mt-6">
        <CardContent className="flex flex-col gap-2 pt-6 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CircleHelp className="size-4 text-primary" />
            Não achou o que precisava?
          </p>
          <p className="text-muted-foreground">
            Use o botão de suporte no canto da tela para falar com a gente pelo WhatsApp.
          </p>
          <p className="flex items-start gap-2 text-muted-foreground">
            <Lightbulb className="mt-0.5 size-4 shrink-0" />
            <span>
              Dica: quase toda tela tem um botão <strong>Novo</strong> no topo. Se estiver
              perdido, comece por ele.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
