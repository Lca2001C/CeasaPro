import Link from "next/link";
import type { ReactNode } from "react";
import { BadgeCheck, Bell, Palette, Store, TrendingUp, UserRound } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { ConfigService } from "@/lib/services/config.service";
import { formatBRL, formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { IconeRedondo } from "@/components/ui/icone-redondo";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MeuPlanoConteudo } from "../plano/_components/meu-plano-conteudo";
import { IrParaAba } from "./_components/ir-para-aba";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { PushOptIn } from "@/components/pwa/push-opt-in";
import { EmpresaConfigForm } from "./_components/empresa-form";
import { PerfilConfigForm } from "./_components/perfil-form";
import { CancelarAssinatura } from "@/components/billing/cancelar-assinatura";
import { empresaSemNome } from "@/lib/tenant-defaults";
import { isModuleEnabled } from "@/lib/plan/modules";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { EscolherCentral } from "../cotacoes/_components/escolher-central";
import { SeletorDeTema } from "@/components/tema/controles-de-tema";

export const dynamic = "force-dynamic";

/** Cor do selo da situação: tom semântico porque é ESTADO da assinatura. */
const TOM_DA_SITUACAO: Record<string, BadgeProps["variant"]> = {
  ATIVO: "success",
  TRIAL: "info",
  VENCIDO: "warning",
  SUSPENSO: "destructive",
  BLOQUEADO: "destructive",
  CANCELADO: "destructive",
};

/** Cabeçalho de cartão com ícone redondo — o mesmo desenho em todas as abas. */
function TituloDoCartao({
  icone,
  titulo,
  descricao,
}: {
  icone: ReactNode;
  titulo: string;
  descricao?: string;
}) {
  return (
    <CardHeader>
      <div className="flex items-center gap-3">
        <IconeRedondo>{icone}</IconeRedondo>
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle className="text-base">{titulo}</CardTitle>
          {descricao && <CardDescription>{descricao}</CardDescription>}
        </div>
      </div>
    </CardHeader>
  );
}

/** Linha "rótulo → valor" do resumo da assinatura. */
function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <dt className="text-sm text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 text-right font-semibold tabular-nums [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

const ABAS = ["empresa", "perfil", "plano", "assinatura"] as const;

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; bloqueado?: string }>;
}) {
  const sp = await searchParams;
  const aba = ABAS.find((a) => a === sp.aba) ?? "empresa";
  const { tenantId, session } = await requireTenant();
  const t = await ConfigService.getCompany(tenantId);
  const sub = t?.subscription;
  const temCotacoes = isModuleEnabled(session.modules, "cotacoes");
  /*
    O seletor de central aparece para quem TEM o módulo — e também para quem já
    tem uma central escolhida, mesmo sem o módulo.

    O cadastro público pergunta a central, mas entra no plano mais barato, que
    não inclui Cotações. Sem o segundo caso, quem escolheu a praça errada no
    cadastro não teria como corrigir nem limpar até contratar o módulo: o campo
    ficaria gravado, invisível e intocável. É dado da empresa, e o dono tem de
    poder mexer no que ele mesmo informou.
  */
  const mostrarCentral = temCotacoes || Boolean(t?.ceasaCentralCode);
  const centrais = mostrarCentral ? await CotacoesService.listarCentrais() : [];

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Seus dados, os da empresa, o plano e a assinatura."
      />
      <div className="flex flex-col gap-5">
        <Tabs defaultValue={aba}>
          <TabsList>
            <TabsTrigger value="empresa">Empresa</TabsTrigger>
            <TabsTrigger value="perfil">Meu perfil</TabsTrigger>
            <TabsTrigger value="plano">Meu plano</TabsTrigger>
            <TabsTrigger value="assinatura">Assinatura</TabsTrigger>
          </TabsList>
          <TabsContent value="empresa" className="flex flex-col gap-5">
            <Card>
              <TituloDoCartao icone={<Store />} titulo="Dados da empresa" />
              <CardContent>
                <EmpresaConfigForm
                  initial={{
                    // O nome de partida não é pré-preenchido: deixá-lo no campo faria a
                    // pessoa clicar "Salvar" e carimbá-lo como se fosse escolha dela —
                    // e aí o aviso de cadastro incompleto sumiria sem nada ter sido
                    // preenchido.
                    tradeName: empresaSemNome(t?.tradeName) ? "" : (t?.tradeName ?? ""),
                    legalName: t?.legalName ?? "",
                    cnpj: t?.cnpj ?? "",
                    phone: t?.phone ?? "",
                    address: t?.address ?? "",
                    businessHours: t?.businessHours ?? "",
                    establishmentType: t?.establishmentType ?? "",
                    uf: t?.uf ?? "",
                  }}
                />
              </CardContent>
            </Card>
            {/*
              A central do CEASA é dado da EMPRESA — onde ela compra —, então mora
              nesta aba e não em "Meu perfil", que é sobre a pessoa. Ver
              `mostrarCentral` acima para quando ela aparece.
            */}
            {mostrarCentral && (
              <Card>
                <TituloDoCartao icone={<TrendingUp />} titulo="Cotações do CEASA" />
                <CardContent>
                  <EscolherCentral centrais={centrais} atual={t?.ceasaCentralCode ?? null} />
                </CardContent>
              </Card>
            )}
          </TabsContent>
          <TabsContent value="perfil" className="flex flex-col gap-5">
            <Card>
              <TituloDoCartao icone={<UserRound />} titulo="Seus dados" />
              <CardContent>
                <PerfilConfigForm initial={{ name: session.name }} email={session.email} />
              </CardContent>
            </Card>
            {/* Preferência do APARELHO (fica no navegador), não da conta. */}
            <Card>
              <TituloDoCartao
                icone={<Palette />}
                titulo="Aparência"
                descricao="Automático segue o celular ou computador. A escolha vale para este aparelho."
              />
              <CardContent>
                <SeletorDeTema />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="plano" className="flex flex-col gap-5">
            {/* Só a aba pedida carrega o plano no servidor (ver `IrParaAba`). */}
            {aba === "plano" ? (
              <MeuPlanoConteudo tenantId={tenantId} bloqueado={sp.bloqueado} />
            ) : (
              <IrParaAba href="/configuracoes?aba=plano" />
            )}
          </TabsContent>
          <TabsContent value="assinatura" className="flex flex-col gap-5">
            <Card>
              <TituloDoCartao icone={<BadgeCheck />} titulo="Sua assinatura" />
              <CardContent className="flex flex-col gap-4">
                {sub ? (
                  <>
                    <dl className="divide-y divide-border/60 border-y border-border/60">
                      <Linha rotulo="Plano">{sub.plan.name}</Linha>
                      <Linha rotulo="Situação">
                        <Badge variant={TOM_DA_SITUACAO[sub.status] ?? "secondary"}>
                          {SUBSCRIPTION_STATUS_LABELS[sub.status]}
                        </Badge>
                      </Linha>
                      {/*
                        Quem NUNCA pagou tem `currentPeriodEnd` no passado — é a
                        data do cadastro. Mostrar "Vencimento <data já passada>" e
                        "Mensalidade R$ X" durante o teste grátis fazia a tela
                        afirmar que a assinatura venceu e que havia mensalidade a
                        pagar, contradizendo a faixa do topo ("seu teste termina em
                        N dias") — justamente na janela em que o cliente decide se
                        fica. A tela de /assinatura já se protege disso com a mesma
                        regra (`primeiraAtivacao`).
                      */}
                      {sub.activatedAt ? (
                        <>
                          <Linha rotulo="Mensalidade">{formatBRL(sub.monthlyAmount)}</Linha>
                          <Linha rotulo="Vencimento">{formatDate(sub.currentPeriodEnd)}</Linha>
                        </>
                      ) : sub.trialEndsAt ? (
                        <Linha rotulo="Teste grátis até">{formatDate(sub.trialEndsAt)}</Linha>
                      ) : (
                        <Linha rotulo="Mensalidade">{formatBRL(sub.monthlyAmount)}</Linha>
                      )}
                    </dl>
                    <Button asChild variant="success" className="w-full sm:w-auto sm:self-start">
                      <Link href="/assinatura">Ver / pagar mensalidade</Link>
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma assinatura ativa.</p>
                )}
              </CardContent>
            </Card>
            {sub && (
              <CancelarAssinatura
                cancelledAt={sub.cancelledAt}
                currentPeriodEnd={sub.currentPeriodEnd}
                status={sub.status}
              />
            )}
          </TabsContent>
        </Tabs>

        <Card>
          <TituloDoCartao icone={<Bell />} titulo="Aplicativo e avisos" />
          <CardContent className="flex flex-col gap-5">
            {/*
              Caminho permanente para o atalho na tela inicial. O convite automatico
              aparece uma vez e respeita "Agora nao" por 7 dias — sem esta entrada,
              quem dispensou (ou trocou de celular) nao teria como voltar a instalar.
              O componente se esconde sozinho quando o app JA esta instalado.
            */}
            <InstallPrompt triggerLabel="Instalar app / atalho na tela inicial" />

            {/*
              Opt-in de notificacao SEPARADO da instalacao, de proposito: sao dois
              pedidos, e junta-los derruba a aceitacao dos dois. Pior: a permissao de
              notificacao negada nao pode ser pedida de novo pelo site.

              A chave publica VAPID vem do servidor. Sem ela configurada o componente
              se anuncia como sem suporte em vez de oferecer um botao que falharia.
            */}
            <PushOptIn vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
