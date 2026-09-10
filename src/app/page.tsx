import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import {
  ArrowRight,
  Boxes,
  Check,
  ClipboardList,
  FileSpreadsheet,
  HandCoins,
  ShoppingCart,
  Warehouse,
} from "lucide-react";
import { PlanoService } from "@/lib/services/plano.service";
import { TRIAL_DAYS } from "@/lib/billing/status";
import { Button } from "@/components/ui/button";
import { landingMetadata, landingJsonLd } from "@/lib/seo/landing";

export const metadata = landingMetadata();

// Renderizada por requisição para receber o nonce do CSP (ver `src/proxy.ts`).
// Pré-renderizada em build, o HTML sairia sem nonce e o `'strict-dynamic'`
// bloquearia o JS da página. Também é o que mantém a tabela de preços em dia:
// ela lê os planos do banco a cada visita.
export const dynamic = "force-dynamic";

const RECURSOS = [
  {
    icon: ShoppingCart,
    titulo: "Frente de caixa e vendas no box",
    texto:
      "PDV pensado para o ritmo do CEASA: escolhe o produto, ajusta o peso, fecha. " +
      "Sem navegar por dez telas com o cliente esperando.",
  },
  {
    icon: Warehouse,
    titulo: "Controle de estoque de hortifrúti",
    texto:
      "O preço muda todo dia. Registre a compra com o valor do boletim e veja na hora " +
      "quanto sobra em cada caixa que você vende.",
  },
  {
    icon: Boxes,
    titulo: "Gestão de caixaria e embalagens",
    texto:
      "Caixas plásticas emprestadas por cliente, higienização e o que ainda está na rua. " +
      "O prejuízo que ninguém lança na planilha.",
  },
  {
    icon: HandCoins,
    titulo: "Controle de fiado no box",
    texto:
      "Quem deve, quanto, desde quando e o que já pagou. Com aviso de vencido antes de " +
      "você lembrar de perguntar.",
  },
  {
    icon: ClipboardList,
    titulo: "Controle financeiro do box",
    texto:
      "Frete, funcionário, aluguel do box, embalagem. Lançadas por categoria, com " +
      "vencimento, para o resultado do mês não ser uma surpresa.",
  },
  {
    icon: FileSpreadsheet,
    titulo: "Relatórios de venda e carga",
    texto:
      "Vendas, compras, fiado e resultado em Excel e PDF — a lista do que saiu e o " +
      "fechamento do dia, prontos para o contador.",
  },
];

function precoBR(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function LandingPage() {
  const planos = await PlanoService.listPublicPlans();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(landingJsonLd()) }}
      />

      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold text-primary">
            {/*
              `next/image` e não `<img>`: é a única imagem do app, e ela está na
              landing — a página que o Google mede. O otimizador serve o PNG de
              192px como webp no tamanho pedido, em vez de mandar o arquivo
              inteiro para renderizar a 32px.

              `priority` porque o logo fica no cabeçalho fixo, acima da dobra: o
              padrão do componente é carregar preguiçosamente, e aqui isso
              atrasaria justamente o elemento que entra na medição de LCP.

              O `/_next/image` do otimizador passa POR FORA do proxy
              (`proxy.ts`, e `tests/unit/proxy-matcher.test.ts` guarda isso), então
              não exige sessão — o que importa numa página que o visitante anônimo
              é quem mais vê.
            */}
            <Image
              src="/icons/icon-192.png"
              width={32}
              height={32}
              priority
              alt="Logotipo do CeasaPro, sistema de gestão para atacadistas e hortifrúti no CEASA"
              className="size-8 rounded-md"
            />
            CeasaPro
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Já tenho conta</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/cadastro">Testar grátis</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:py-20">
          <div className="flex flex-col items-start gap-5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {TRIAL_DAYS} dias grátis — sem cartão de crédito
            </span>
            <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Sistema de gestão para atacadistas e hortifrúti no CEASA — sem planilha e sem
              caderno
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              Vendas, estoque, caixaria, fiado e o financeiro do box no mesmo lugar. Feito para
              quem comercializa hortifrúti e precisa saber, no fim do dia, quanto entrou e
              quanto sobrou.
            </p>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/cadastro">
                  Testar {TRIAL_DAYS} dias grátis <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Já tenho conta</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Você cria a conta e usa tudo por {TRIAL_DAYS} dias. Não pedimos cartão para
              começar.
            </p>
          </div>
        </section>

        <section className="border-y bg-secondary/30">
          <div className="mx-auto w-full max-w-5xl px-4 py-14">
            <h2 className="text-2xl font-bold tracking-tight">
              Recursos para atacadistas e hortifrúti no CEASA
            </h2>
            <p className="mt-1.5 text-muted-foreground">
              Não é um ERP genérico adaptado. Cada tela nasceu de um problema do box.
            </p>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {RECURSOS.map(({ icon: Icon, titulo, texto }) => (
                <article key={titulo} className="flex flex-col gap-2">
                  <Icon className="size-6 text-primary" aria-hidden="true" />
                  <h3 className="font-semibold">{titulo}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{texto}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-4 py-14">
          <h2 className="text-2xl font-bold tracking-tight">Planos</h2>
          <p className="mt-1.5 text-muted-foreground">
            Comece pelo teste de {TRIAL_DAYS} dias. Você só escolhe o plano e paga quando
            decidir continuar.
          </p>

          {planos.length === 0 ? (
            <p className="mt-8 rounded-lg border bg-secondary/30 p-4 text-sm text-muted-foreground">
              Nossos planos estão sendo atualizados. Comece o teste grátis e falamos com você
              antes do fim do período.
            </p>
          ) : (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {planos.map((plano, i) => (
                <article
                  key={plano.id}
                  className={`flex flex-col gap-4 rounded-xl border p-5 ${
                    i === 0 ? "border-primary shadow-sm" : ""
                  }`}
                >
                  <header>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{plano.name}</h3>
                      {i === 0 && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          Mais simples
                        </span>
                      )}
                    </div>
                    <p className="mt-2">
                      <span className="text-3xl font-bold">{precoBR(plano.priceMonthly)}</span>
                      <span className="text-sm text-muted-foreground"> /mês</span>
                    </p>
                  </header>

                  <ul className="flex flex-col gap-1.5 text-sm">
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>Vendas, fiado, estoque e despesas</span>
                    </li>
                    {plano.modules.map((m) => (
                      <li key={m} className="flex items-start gap-2">
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>

                  <Button asChild className="mt-auto" variant={i === 0 ? "default" : "outline"}>
                    <Link href="/cadastro">Testar {TRIAL_DAYS} dias grátis</Link>
                  </Button>
                </article>
              ))}
            </div>
          )}

          <p className="mt-6 text-sm text-muted-foreground">
            Pagamento por PIX ou cartão. Sem fidelidade — você cancela quando quiser.
          </p>
        </section>

        <section className="border-t bg-primary/5">
          <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-4 px-4 py-14">
            <h2 className="text-2xl font-bold tracking-tight">
              Comece hoje e veja o resultado do primeiro dia
            </h2>
            <p className="max-w-xl text-muted-foreground">
              Leva menos de dois minutos para criar a conta. Sem cartão, sem contrato.
            </p>
            <Button asChild size="lg">
              <Link href="/cadastro">
                Criar minha conta grátis <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>CeasaPro — sistema de gestão para atacadistas e hortifrúti no CEASA</span>
          <span className="flex gap-4">
            <Link href="/termos" className="hover:underline">
              Termos de Uso
            </Link>
            <Link href="/privacidade" className="hover:underline">
              Política de Privacidade
            </Link>
            <Link href="/login" className="hover:underline">
              Entrar
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
