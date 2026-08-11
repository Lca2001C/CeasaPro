"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { excluirEmpresa } from "@/actions/admin.actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function ExcluirEmpresa({
  tenantId,
  tradeName,
}: {
  tenantId: string;
  tradeName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const res = await excluirEmpresa(tenantId);
      if (res.ok) {
        toast.success("Empresa excluída.");
        // O detalhe deixa de existir (getTenant passa a 404) — volta para a lista.
        router.push("/admin/clientes");
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" /> Excluir empresa
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir a empresa {tradeName}?</DialogTitle>
            <DialogDescription>
              A empresa perde o acesso imediatamente e some da lista. Os dados e o
              histórico são preservados (exclusão reversível pelo suporte).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmar} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
