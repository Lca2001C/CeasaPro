"use client";

import { useTransition } from "react";
import { LayoutGrid, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { abrirMeuAmbiente } from "@/actions/admin.actions";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { irComSessaoNova } from "@/lib/session-nav";

/**
 * Leva o super-admin do painel da plataforma para o sistema em si.
 *
 * O `/api/auth/refresh` no meio não é enfeite: o `tenantId` do ambiente entra
 * no access token, e sem reemitir a sessão o proxy leria o token antigo (sem
 * tenant) e devolveria o admin para `/admin` — um vai-e-volta sem explicação.
 * Por isso a navegação usa `irComSessaoNova` (documento novo) e não o router: o
 * `/dashboard` pode já estar no cache RSC, buscado com o token antigo.
 */
export function AbrirAmbienteButton() {
  const [pending, start] = useTransition();

  function abrir() {
    start(async () => {
      const res = await abrirMeuAmbiente();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      if (res.data.criado) toast.success("Ambiente criado. Abrindo o sistema...");
      await apiPost("/api/auth/refresh", {});
      irComSessaoNova("/dashboard");
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={abrir} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <LayoutGrid className="size-4" />}
      <span className="hidden sm:inline">Usar o sistema</span>
    </Button>
  );
}
