"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { desfazerAjusteEstoque } from "@/actions/estoque.actions";
import { Button } from "@/components/ui/button";
import { chamarAction } from "@/lib/http/chamar-action";

/** "Desfazer" de um ajuste manual das últimas 24 h (regra única de desfazer). */
export function DesfazerAjusteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function desfazer() {
    start(async () => {
      const res = await chamarAction(() => desfazerAjusteEstoque({ id }));
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Ajuste desfeito. O estoque voltou ao que era.");
      router.refresh();
    });
  }

  return (
    <Button variant="destructive" size="sm" onClick={desfazer} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Undo2 />}
      Desfazer
    </Button>
  );
}
