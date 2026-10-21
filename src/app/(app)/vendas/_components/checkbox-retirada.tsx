"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { marcarRetirada } from "@/actions/vendas.actions";
import { chamarAction } from "@/lib/http/chamar-action";
import { cn } from "@/lib/cn";
import { EVENTO_ATUALIZAR_NOTIFICACOES } from "@/components/layout/sino-notificacoes";

/**
 * "Buscado / Aguardando" da venda que o cliente vai buscar depois.
 *
 * Botão com `role="checkbox"` (não `<input>` escondido): o alvo inteiro tem
 * altura de dedo e o leitor de tela anuncia o estado. A troca é otimista — o
 * balcão não espera a rede para ver o check — e volta se o servidor recusar.
 */
export function CheckboxRetirada({
  vendaId,
  retirado,
  cliente,
}: {
  vendaId: string;
  retirado: boolean;
  cliente: string;
}) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [marcado, setMarcado] = useOptimistic(retirado);

  function alternar() {
    const novo = !marcado;
    start(async () => {
      setMarcado(novo);
      const res = await chamarAction(() => marcarRetirada({ id: vendaId, retirado: novo }));
      if (res.ok) {
        toast.success(novo ? `Retirada de ${cliente} confirmada` : "Voltou para aguardando");
        router.refresh();
        window.dispatchEvent(new Event(EVENTO_ATUALIZAR_NOTIFICACOES));
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcado}
      aria-label={`${marcado ? "Desmarcar" : "Marcar"} retirada de ${cliente}`}
      onClick={alternar}
      disabled={pendente}
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-1.5 text-left outline-none motion-safe:transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        marcado
          ? "border-primary/60 bg-primary/10 hover:bg-primary/15"
          : "border-border hover:bg-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md border-2",
          marcado ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60",
        )}
      >
        {pendente ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : marcado ? (
          <Check className="size-4" strokeWidth={3} />
        ) : null}
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">
          {marcado ? "Buscado" : "Aguardando"}
        </span>
        <span className="block text-xs text-muted-foreground">
          {marcado ? "Produto retirado" : "Marcar ao retirar"}
        </span>
      </span>
    </button>
  );
}
