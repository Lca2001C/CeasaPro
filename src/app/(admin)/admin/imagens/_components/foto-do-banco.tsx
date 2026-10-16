"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { atualizarFotoDoBanco, excluirFotoDoBanco } from "@/actions/admin-imagens.actions";
import { chamarAction } from "@/lib/http/chamar-action";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function FotoDoBanco({
  foto,
}: {
  foto: { id: string; nome: string; url: string | null; ativo: boolean; emUso: number };
}) {
  const router = useRouter();
  const [nome, setNome] = useState(foto.nome);
  const [pending, start] = useTransition();

  function salvar(patch: { nome?: string; ativo?: boolean }) {
    start(async () => {
      const res = await chamarAction(() =>
        atualizarFotoDoBanco({
          id: foto.id,
          nome: (patch.nome ?? nome).trim(),
          ativo: patch.ativo ?? foto.ativo,
        }),
      );
      if (res.ok) {
        toast.success("Foto atualizada");
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  function excluir() {
    if (!window.confirm(`Excluir a foto "${foto.nome}" do banco?`)) return;
    start(async () => {
      const res = await chamarAction(() => excluirFotoDoBanco(foto.id));
      if (res.ok) {
        toast.success("Foto excluída");
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <Card className={cn("flex flex-col gap-2 p-2", !foto.ativo && "opacity-70")}>
      {foto.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto do bucket público
        <img
          src={foto.url}
          alt={foto.nome}
          className="aspect-square w-full rounded object-cover"
          loading="lazy"
        />
      ) : (
        <span className="aspect-square w-full rounded bg-muted" />
      )}
      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onBlur={() => nome.trim() && nome.trim() !== foto.nome && salvar({ nome })}
        aria-label={`Nome da foto ${foto.nome}`}
      />
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {!foto.ativo && <Badge variant="secondary">Desativada</Badge>}
        <span>
          {foto.emUso} produto{foto.emUso === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={foto.ativo ? "outline" : "success"}
          className="flex-1"
          disabled={pending}
          onClick={() => salvar({ ativo: !foto.ativo })}
        >
          {pending && <Loader2 className="animate-spin" />}
          {foto.ativo ? "Desativar" : "Ativar"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending || foto.emUso > 0}
          title={foto.emUso > 0 ? "Em uso — desative em vez de excluir" : "Excluir"}
          aria-label={`Excluir a foto ${foto.nome}`}
          onClick={excluir}
        >
          <Trash2 /> Excluir
        </Button>
      </div>
    </Card>
  );
}
