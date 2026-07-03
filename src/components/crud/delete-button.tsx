"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/http/action-result";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface Props {
  /** Server Action que recebe o id e faz o soft delete. */
  action: (id: string) => Promise<ActionResult<unknown>>;
  id: string;
  entityLabel: string; // ex.: "o produto Tomate"
  onDeleted?: () => void;
}

export function DeleteButton({ action, id, entityLabel, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function confirm() {
    start(async () => {
      const res = await action(id);
      if (res.ok) {
        toast.success("Excluído com sucesso");
        setOpen(false);
        onDeleted?.();
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Excluir"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4 text-destructive" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir {entityLabel}?</DialogTitle>
          <DialogDescription>
            Esta ação não poderá ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
