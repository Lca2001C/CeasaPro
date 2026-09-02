import Link from "next/link";
import { Building2, ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/session";
import { AdminService } from "@/lib/services/admin.service";
import { JANELA_ONLINE_MINUTOS } from "@/lib/auth/presence";
import type { SituacaoCobrancaDetalhe } from "@/lib/billing/status";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { AcoesUsuario } from "./_components/acoes-usuario";

export const dynamic = "force-dynamic";

/**
 * Rótulo da situação de cobrança.
 *
 * "Inadimplente" é um grupo com graus diferentes, e a distinção é acionável: em
 * VENCIDO o cliente ainda entra (está na tolerância) e uma cobrança resolve; em
 * SUSPENSO ele já perdeu o acesso e provavelmente vai ligar reclamando. Espremer
 * os dois no mesmo texto esconderia justamente quem ainda dá para recuperar.
 */
function rotuloCobranca(c: SituacaoCobrancaDetalhe): {
  texto: string;
  variant: "success" | "warning" | "destructive";
} {
  if (c.situacao === "em_dia")
    return { texto: "Pagamento em dia", variant: "success" };

  if (c.situacao === "em_teste") {
    return {
      texto:
        c.diasDeTeste === null
          ? "Em teste"
          : c.diasDeTeste === 0
            ? "Teste terminando hoje"
            : `Em teste · ${c.diasDeTeste} dia(s)`,
      variant: "warning",
    };
  }

  switch (c.statusEfetivo) {
    case "VENCIDO":
      return { texto: "Mensalidade vencida", variant: "warning" };
    case "CANCELADO":
      return { texto: "Assinatura cancelada", variant: "destructive" };
    case "BLOQUEADO":
      return { texto: "Assinatura bloqueada", variant: "destructive" };
    case null:
      return { texto: "Sem assinatura", variant: "destructive" };
    default:
      // SUSPENSO: nunca pagou e o teste acabou, ou passou da tolerância.
      return { texto: "Inadimplente", variant: "destructive" };
  }
}

const FILTROS = [
  { chave: undefined, label: "Todos" },
  { chave: "ONLINE", label: "Online" },
  { chave: "TESTE", label: "Em teste" },
  { chave: "EM_DIA", label: "Em dia" },
  { chave: "INADIMPLENTES", label: "Inadimplentes" },
  { chave: "INATIVOS", label: "Sem acesso" },
] as const;

export default async function AdminUsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filtro?: string }>;
}) {
  const session = await requireSuperAdmin();
  const { q, filtro } = await searchParams;
  const busca = q?.trim() || undefined;

  /**
   * Uma consulta só, e a filtragem da tela em memória.
   *
   * Assim os contadores contam sempre o mesmo conjunto, independente do filtro
   * escolhido — se o filtro entrasse no SQL, clicar em "Sem acesso" faria os
   * cartões contarem apenas os sem acesso, e o painel passaria a se contradizer.
   */
  const todos = await AdminService.listUsers({ busca });

  const online = todos.filter((u) => u.online).length;
  const emTeste = todos.filter(
    (u) => u.cobranca?.situacao === "em_teste",
  ).length;
  const emDia = todos.filter((u) => u.cobranca?.situacao === "em_dia").length;
  const inadimplentes = todos.filter(
    (u) => u.cobranca?.situacao === "inadimplente",
  ).length;
  const semAcesso = todos.filter((u) => !u.active).length;

  const usuarios = todos.filter((u) => {
    switch (filtro) {
      case "ONLINE":
        return u.online;
      case "TESTE":
        return u.cobranca?.situacao === "em_teste";
      case "EM_DIA":
        return u.cobranca?.situacao === "em_dia";
      case "INADIMPLENTES":
        return u.cobranca?.situacao === "inadimplente";
      case "INATIVOS":
        return !u.active;
      default:
        return true;
    }
  });

  const linkFiltro = (chave?: string) => {
    const p = new URLSearchParams();
    if (chave) p.set("filtro", chave);
    if (busca) p.set("q", busca);
    const qs = p.toString();
    return `/admin/usuarios${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Usuários"
        description="Quem tem acesso ao sistema, quem está usando agora, e como está o pagamento de cada empresa."
      />

      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="Online agora"
          value={String(online)}
          tone="success"
          hint={`Sessão ativa nos últimos ${JANELA_ONLINE_MINUTOS} min`}
        />
        <StatCard label="Em teste" value={String(emTeste)} tone="warning" />
        <StatCard
          label="Pagamento em dia"
          value={String(emDia)}
          tone="success"
        />
        <StatCard
          label="Inadimplentes"
          value={String(inadimplentes)}
          tone={inadimplentes > 0 ? "destructive" : "default"}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard label="Com acesso" value={String(todos.length - semAcesso)} />
        <StatCard label="Sem acesso" value={String(semAcesso)} />
      </div>

      {/* Busca sem JS: `form` com GET escreve na própria URL. */}
      <form method="GET" className="mb-3 flex gap-2">
        {filtro && <input type="hidden" name="filtro" value={filtro} />}
        <Input
          name="q"
          defaultValue={busca ?? ""}
          placeholder="Buscar por nome ou e-mail"
          aria-label="Buscar usuário"
          className="h-11"
        />
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.label}
            asChild
            size="sm"
            variant={(filtro ?? undefined) === f.chave ? "default" : "outline"}
          >
            <Link href={linkFiltro(f.chave)}>{f.label}</Link>
          </Button>
        ))}
      </div>

      {usuarios.length === 0 ? (
        <EmptyState
          title="Nenhum usuário encontrado"
          description={
            busca
              ? "Tente outro nome ou e-mail."
              : "Nenhum usuário neste filtro."
          }
        />
      ) : (
        /*
          Lista de verdade (`ul`/`li`) e não uma pilha de `div`: com o crachá de
          situação, cada linha passou a ter vários pedaços de informação, e um
          leitor de tela sem a semântica de lista lê tudo como um texto corrido,
          sem dizer onde um usuário termina e o outro começa.
        */
        <ul aria-label="Usuários" className="flex flex-col gap-2">
          {usuarios.map((u) => {
            const ehVoce = u.id === session.sub;
            const cobranca = u.cobranca ? rotuloCobranca(u.cobranca) : null;
            return (
              <li key={u.id}>
                <Card
                  className={cn(
                    "flex items-center justify-between gap-2 p-3",
                    !u.active && "opacity-70",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{u.name}</span>
                      {u.online && (
                        <Badge variant="success" className="gap-1.5">
                          <span
                            className="size-1.5 rounded-full bg-success"
                            aria-hidden
                          />
                          Online
                        </Badge>
                      )}
                      {u.role === "SUPER_ADMIN" && (
                        <Badge variant="secondary" className="gap-1">
                          <ShieldCheck className="size-3" /> Admin
                        </Badge>
                      )}
                      {cobranca && (
                        <Badge variant={cobranca.variant}>
                          {cobranca.texto}
                        </Badge>
                      )}
                      {!u.active && (
                        <Badge variant="destructive">Sem acesso</Badge>
                      )}
                      {u.mustChangePassword && (
                        <Badge variant="warning">Senha provisória</Badge>
                      )}
                      {ehVoce && <Badge variant="outline">você</Badge>}
                    </div>
                    <span className="block truncate text-xs text-muted-foreground">
                      {u.email}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {u.tenant ? (
                        <>
                          <Building2 className="mr-1 inline size-3" />
                          {u.tenant.deletedAt ? (
                            <span className="text-destructive">
                              {u.tenant.tradeName} (empresa excluída)
                            </span>
                          ) : (
                            <Link
                              href={`/admin/clientes/${u.tenant.id}`}
                              className="underline underline-offset-2"
                            >
                              {u.tenant.tradeName}
                            </Link>
                          )}
                        </>
                      ) : (
                        "Sem empresa vinculada"
                      )}
                      {u.lastLoginAt
                        ? ` · último acesso ${formatDateTime(u.lastLoginAt)}`
                        : " · nunca entrou"}
                    </span>
                  </div>

                  <AcoesUsuario
                    userId={u.id}
                    nome={u.name}
                    ativo={u.active}
                    ehVoce={ehVoce}
                  />
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
