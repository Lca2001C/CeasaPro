"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { marcarDespesaComoPaga } from "@/actions/despesas.actions";
import { chamarAction } from "@/lib/http/chamar-action";
import { Button } from "@/components/ui/button";

/** "Marcar como paga" da compra a prazo — quita a despesa que a compra gerou. */
export function PagarCompraButton({ despesaId }: { despesaId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      className="bg-success text-success-foreground hover:bg-success/90"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await chamarAction(() => marcarDespesaComoPaga({ id: despesaId }));
          if (res.ok) {
            toast.success("Compra paga hoje");
            router.refresh();
          } else {
            toast.error(res.error.message);
          }
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Check />}
      Marcar como paga
    </Button>
  );
}
