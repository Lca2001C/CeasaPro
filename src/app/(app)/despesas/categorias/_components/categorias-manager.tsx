"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  criarCategoriaDespesa,
  renomearCategoriaDespesa,
  excluirCategoriaDespesa,
} from "@/actions/despesas.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface CategoriaItem {
  id: string;
  name: string;
  isDefault: boolean;
  despesas: number;
}

/**
 * Gestão das categorias de despesa.
 *
 * A action de criar categoria já existia, mas não havia tela: cada box tem
 * despesa própria ("Frete", "Gás", "Embalagem descartável") e sem isso todos
 * ficavam presos às categorias genéricas do onboarding.
 *
 * Duas travas, iguais às do servidor: categoria padrão não se apaga (mas pode
 * ser renomeada) e categoria em uso não se apaga — senão o histórico já
 * classificado perderia a classificação.
 */
export function CategoriasManager({ categorias }: { categorias: CategoriaItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nova, setNova] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState("");
  const [aExcluir, setAExcluir] = useState<CategoriaItem | null>(null);

  function criar() {
    const name = nova.trim();
    if (!name) return toast.error("Informe o nome da categoria.");
    start(async () => {
      const res = await criarCategoriaDespesa({ name });
      if (res.ok) {
        toast.success(`Categoria "${name}" criada`);
        setNova("");
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  function salvarNome(id: string) {
    const name = editandoNome.trim();
    if (!name) return toast.error("Informe o nome da categoria.");
    start(async () => {
      const res = await renomearCategoriaDespesa({ id, name });
      if (res.ok) {
        toast.success("Categoria renomeada");
        setEditandoId(null);
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  function excluir(c: CategoriaItem) {
    start(async () => {
      const res = await excluirCategoriaDespesa(c.id);
      if (res.ok) {
        toast.success("Categoria excluída");
        setAExcluir(null);
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2 p-3">
        <Label htmlFor="nova-categoria">Nova categoria</Label>
        <div className="flex gap-2">
          <Input
            id="nova-categoria"
            className="flex-1"
            placeholder="Ex.: Frete, Gás, Embalagem descartável"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") criar();
            }}
          />
          <Button onClick={criar} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Plus />}
            Criar
          </Button>
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        {categorias.map((c) => (
          <Card key={c.id} className="flex items-center justify-between gap-2 p-3">
            {editandoId === c.id ? (
              <>
                <Input
                  className="flex-1"
                  value={editandoNome}
                  onChange={(e) => setEditandoNome(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") salvarNome(c.id);
                    if (e.key === "Escape") setEditandoId(null);
                  }}
                  autoFocus
                  aria-label={`Novo nome para ${c.name}`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Salvar nome"
                  onClick={() => salvarNome(c.id)}
                  disabled={pending}
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4 text-success" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cancelar"
                  onClick={() => setEditandoId(null)}
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.isDefault && <Badge variant="secondary">Padrão</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {c.despesas === 0
                      ? "Nenhuma despesa usa esta categoria"
                      : `${c.despesas} despesa(s)`}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Renomear ${c.name}`}
                    title="Renomear"
                    onClick={() => {
                      setEditandoId(c.id);
                      setEditandoNome(c.name);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {/* Padrão e em uso não podem sair: o botão fica desabilitado
                      com o motivo no title, em vez de falhar depois do clique. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${c.name}`}
                    title={
                      c.isDefault
                        ? "Categoria padrão — pode ser renomeada, não excluída"
                        : c.despesas > 0
                          ? "Em uso por despesas — troque a categoria delas antes"
                          : "Excluir"
                    }
                    disabled={c.isDefault || c.despesas > 0}
                    onClick={() => setAExcluir(c)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </>
            )}
          </Card>
        ))}
      </div>

      <Dialog open={aExcluir !== null} onOpenChange={(o) => !o && setAExcluir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir a categoria {aExcluir?.name}?</DialogTitle>
            <DialogDescription>
              Nenhuma despesa usa esta categoria, então nada do histórico muda.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => aExcluir && excluir(aExcluir)}
              disabled={pending}
            >
              {pending && <Loader2 className="animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
