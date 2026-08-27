"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PlanoInput } from "@/lib/validations/admin";
import { excluirPlano } from "@/actions/admin.actions";
import { formatBRL } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlanoForm } from "./plano-form";

export function PlanoRow({ plano }: { plano: PlanoInput & { id: string } }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** Mensagem do servidor quando só empresas EXCLUÍDAS travam a exclusão. */
  const [bloqueio, setBloqueio] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function excluir(apagarHistoricoDeExcluidas = false) {
    start(async () => {
      const res = await excluirPlano({ id: plano.id, apagarHistoricoDeExcluidas });
      if (!res.ok) {
        // Plano em uso cai aqui, com a contagem de assinaturas na mensagem.
        // "Confirme a exclusão do histórico" = só empresas já excluídas travam,
        // e existe um segundo passo que resolve.
        if (/histórico/i.test(res.error.message)) {
          setBloqueio(res.error.message);
          setConfirming(false);
          return;
        }
        toast.error(res.error.message);
        setConfirming(false);
        return;
      }
      toast.success(`Plano ${res.data.name} excluído.`);
      setConfirming(false);
      setBloqueio(null);
      router.refresh();
    });
  }

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{plano.name}</span>
            {!plano.active && <Badge variant="secondary">Inativo</Badge>}
          </div>
          <span className="text-xs text-muted-foreground">
            {plano.maxUsers ? `Até ${plano.maxUsers} usuários` : "Usuários ilimitados"} ·{" "}
            {plano.modules.length} módulo(s) opcional(is)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold tabular-nums">{formatBRL(plano.priceMonthly)}/mês</span>
          <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditing((v) => !v)}>
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Excluir plano ${plano.name}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 border-t pt-3">
          <PlanoForm initial={plano} onDone={() => setEditing(false)} />
        </div>
      )}

      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir o plano {plano.name}?</DialogTitle>
            <DialogDescription>
              A exclusão é definitiva e não tem desfazer. Só é possível se nenhuma empresa
              tiver esse plano — se alguma tiver, <b>desative</b> o plano em vez de excluir:
              ele some da oferta e quem já assinou continua como está.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => excluir()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Excluir plano
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Segundo passo: só empresas JÁ EXCLUÍDAS seguram o plano. É o caso da
          limpeza de teste — e apagar o histórico delas leva junto os pagamentos,
          então precisa de uma confirmação própria, não do mesmo botão. */}
      <Dialog open={bloqueio !== null} onOpenChange={(o) => !o && setBloqueio(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar também o histórico das empresas excluídas?</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-2">
                <span>{bloqueio}</span>
                <span>
                  Nenhuma empresa <b>ativa</b> usa este plano. Continuar apaga as
                  assinaturas das empresas já excluídas — e, junto, os{" "}
                  <b>pagamentos registrados nelas</b>. Não tem desfazer.
                </span>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBloqueio(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => excluir(true)} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Apagar histórico e excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
