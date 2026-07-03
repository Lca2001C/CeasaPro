"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { alterarStatusEmpresa } from "@/actions/admin.actions";
import { Button } from "@/components/ui/button";

export function StatusActions({
  tenantId,
  current,
}: {
  tenantId: string;
  current: "ACTIVE" | "SUSPENDED" | "BLOCKED";
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function change(status: "ACTIVE" | "SUSPENDED" | "BLOCKED") {
    start(async () => {
      const res = await alterarStatusEmpresa({ tenantId, status });
      if (res.ok) {
        toast.success("Status atualizado");
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={current === "ACTIVE" ? "default" : "outline"}
        onClick={() => change("ACTIVE")}
        disabled={pending || current === "ACTIVE"}
      >
        Ativar
      </Button>
      <Button
        variant="outline"
        onClick={() => change("SUSPENDED")}
        disabled={pending || current === "SUSPENDED"}
      >
        Suspender
      </Button>
      <Button
        variant="destructive"
        onClick={() => change("BLOCKED")}
        disabled={pending || current === "BLOCKED"}
      >
        Bloquear
      </Button>
    </div>
  );
}
