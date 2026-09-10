import Link from "next/link";
import { Bell, Check, ChevronRight, Store } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { explicacaoSemBoletim } from "@/lib/cotacoes/frescor";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { EscolherCentral } from "../_components/escolher-central";
import { VinculoForm } from "../vincular/_components/vinculo-form";

export const dynamic = "force-dynamic";

/**
 * Primeiro acesso ao módulo de Cotações, em três passos numa página.
 *
 * O que existia antes: contratar o módulo, cair numa grade vazia, descobrir
 * sozinho que era preciso escolher a central, e depois descobrir sozinho que era
 * preciso vincular cada produto. Três descobertas para chegar ao primeiro preço.
 *
 * Por que uma página e não um wizard de passos com estado:
 *
 * Os três passos são independentes e o servidor já sabe em qual deles a empresa
 * está — tem central? tem vínculo? Guardar isso num componente de cliente
 * significaria carregar estado de navegação para responder a uma pergunta que o
 * banco responde. Assim cada ação (escolher central, confirmar vínculos) revalida
 * e o passo seguinte simplesmente acende, sem botão "próximo" para ninguém
 * apertar sem ler.
 *
 * A entrada é estreita de propósito (ver `cotacoes/page.tsx`): `/cotacoes` só
 * manda para cá quem JÁ tem central e NENHUM vínculo — o caso de quem acabou de
 * contratar, ou de quem escolheu a praça no cadastro. Quem não tem central
 * continua caindo no estado vazio da própria grade, que já é o formulário de
 * escolha. E esta página segue alcançável por link depois, porque revisar
 * vínculos não é coisa de uma vez só.
 */
export default async function ComecarCotacoesPage() {
  const { tenantId } = await requireTenant();
  const [centrais, tela] = await Promise.all([
    CotacoesService.listarCentrais(),
    CotacoesService.getTelaDeVinculo(tenantId),
  ]);

  const temCentral = tela.central !== null;
  const temCotacao = tela.doBoletim.length > 0;
  const jaVinculou = tela.produtos.some((p) => p.vinculo !== null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Começar com as cotações"
        description="Três passos, uma vez só: a sua central, os seus produtos e o aviso de preço."
      />

      <Passo numero={1} titulo="Onde você compra" pronto={temCentral} icone={Store}>
        {temCentral ? (
          <>
            <p className="text-sm text-muted-foreground">
              Sua central é <strong className="text-foreground">{tela.central!.name}</strong>. Os
              preços desta tela passam a ser os do boletim que ela publica.
            </p>
            {/*
              Trocar continua possível aqui, e não só em Configurações: quem
              escolheu a praça errada no cadastro descobre isso exatamente agora,
              ao ver nomes de produto que não reconhece.
            */}
            <div className="mt-3">
              <EscolherCentral centrais={centrais} atual={tela.central!.code} />
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Escolha em qual central do CEASA você compra.
            </p>
            <EscolherCentral centrais={centrais} atual={null} autoFoco />
          </>
        )}
      </Passo>

      <Passo
        numero={2}
        titulo="Quais produtos são os seus"
        pronto={jaVinculou}
        icone={Check}
        inativo={!temCentral}
      >
        {!temCentral ? (
          <p className="text-sm text-muted-foreground">
            Escolha a central no passo 1 para o boletim aparecer aqui.
          </p>
        ) : tela.produtos.length === 0 ? (
          <EmptyState
            title="Nenhum produto cadastrado"
            description="Cadastre seus produtos para poder vinculá-los às cotações."
            action={
              <Button asChild size="sm">
                <Link href="/produtos/novo">Cadastrar produto</Link>
              </Button>
            }
          />
        ) : !temCotacao ? (
          /*
            O desfecho que o wizard TEM de ter e que é fácil esquecer.

            A importação da praça roda depois da resposta (`after`), então quem
            acabou de escolher a central chega neste passo com zero cotações — e
            em 57 das 66 praças do catálogo o boletim não vem sozinho nunca. Sem
            esta ramificação, o passo 2 apareceria vazio e sem explicação
            justamente para quem acabou de pagar pelo módulo.
          */
          <>
            <p className="text-sm text-muted-foreground">
              {explicacaoSemBoletim(tela.central!.automatica)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Quando o boletim chegar, Cotações abre aqui de novo — e o vínculo também fica
              em <Link className="underline" href="/cotacoes/vincular">Vincular cotações</Link>.
            </p>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              As linhas em que o nome bate exatamente já vêm marcadas. Confira e confirme —
              nada é salvo antes disso.
            </p>
            <VinculoForm produtos={tela.produtos} doBoletim={tela.doBoletim} />
          </>
        )}
      </Passo>

      <Passo numero={3} titulo="Ser avisado quando o preço mexer" pronto={false} icone={Bell}>
        {/*
          O passo 3 NÃO liga alerta nenhum, e isso é decisão de produto, não
          preguiça de tela.

          O aviso diário por push sai sempre que existe qualquer pendência. Um
          alerta em cada produto vinculado transformaria essa notificação em
          barulho de todo dia — e quem desliga o barulho leva junto o aviso de
          fiado vencido, que é o que ele não pode perder. Então o alerta é
          escalada pedida, item a item, e esta tela só mostra onde se pede.
        */}
        <p className="text-sm text-muted-foreground">
          Já com os vínculos feitos, o Início mostra o preço e a variação do que você compra.
          Se quiser ser avisado sobre um item específico, abra a cotação dele e use
          &ldquo;Me avise quando mexer&rdquo; — vale a pena para o que oscila muito, como
          cebola e tomate.
        </p>
        <div className="mt-3">
          <Button asChild size="sm" variant={jaVinculou ? "default" : "outline"}>
            <Link href="/cotacoes">
              Ver as cotações
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      </Passo>
    </div>
  );
}

function Passo({
  numero,
  titulo,
  pronto,
  inativo = false,
  icone: Icone,
  children,
}: {
  numero: number;
  titulo: string;
  pronto: boolean;
  inativo?: boolean;
  icone: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("p-4", inativo && "opacity-60")}>
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            pronto ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {pronto ? <Check className="size-4" /> : numero}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          <Icone className="size-4 shrink-0 text-muted-foreground" />
          <span className="[overflow-wrap:anywhere]">{titulo}</span>
        </span>
      </div>
      <div className="pl-9">{children}</div>
    </Card>
  );
}
