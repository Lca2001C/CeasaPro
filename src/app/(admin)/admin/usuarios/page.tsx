import Link from "next/link";
import { Building2, ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/session";
import { AdminService } from "@/lib/services/admin.service";
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

export default async function AdminUsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filtro?: string }>;
}) {
  const session = await requireSuperAdmin();
  const { q, filtro } = await searchParams;
  const busca = q?.trim() || undefined;
  const somenteInativos = filtro === "INATIVOS";

  const usuarios = await AdminService.listUsers({ busca, somenteInativos });
  const ativos = usuarios.filter((u) => u.active).length;
  const superAdmins = usuarios.filter((u) => u.role === "SUPER_ADMIN").length;

  return (
    <div>
      <PageHeader
        title="Usuários"
        description="Quem tem acesso ao sistema, de qual empresa, e o estado de cada conta."
      />

      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label="Com acesso" value={String(ativos)} tone="success" />
        <StatCard label="Sem acesso" value={String(usuarios.length - ativos)} />
        <StatCard label="Administradores" value={String(superAdmins)} />
      </div>

      {/* Busca sem JS: `form` com GET escreve na própria URL. */}
      <form method="GET" className="mb-3 flex gap-2">
        {somenteInativos && <input type="hidden" name="filtro" value="INATIVOS" />}
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

      <div className="mb-4 flex gap-2">
        <Button asChild size="sm" variant={somenteInativos ? "outline" : "default"}>
          <Link href={`/admin/usuarios${busca ? `?q=${encodeURIComponent(busca)}` : ""}`}>
            Todos
          </Link>
        </Button>
        <Button asChild size="sm" variant={somenteInativos ? "default" : "outline"}>
          <Link
            href={`/admin/usuarios?filtro=INATIVOS${busca ? `&q=${encodeURIComponent(busca)}` : ""}`}
          >
            Sem acesso
          </Link>
        </Button>
      </div>

      {usuarios.length === 0 ? (
        <EmptyState
          title="Nenhum usuário encontrado"
          description={busca ? "Tente outro nome ou e-mail." : "Nenhum usuário cadastrado."}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {usuarios.map((u) => {
            const ehVoce = u.id === session.sub;
            return (
              <Card
                key={u.id}
                className={cn(
                  "flex items-center justify-between gap-2 p-3",
                  !u.active && "opacity-70",
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{u.name}</span>
                    {u.role === "SUPER_ADMIN" && (
                      <Badge variant="secondary" className="gap-1">
                        <ShieldCheck className="size-3" /> Admin
                      </Badge>
                    )}
                    {!u.active && <Badge variant="destructive">Sem acesso</Badge>}
                    {u.mustChangePassword && <Badge variant="warning">Senha provisória</Badge>}
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
                    {u.lastLoginAt ? ` · último acesso ${formatDateTime(u.lastLoginAt)}` : " · nunca entrou"}
                  </span>
                </div>

                <AcoesUsuario
                  userId={u.id}
                  nome={u.name}
                  ativo={u.active}
                  ehVoce={ehVoce}
                />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
