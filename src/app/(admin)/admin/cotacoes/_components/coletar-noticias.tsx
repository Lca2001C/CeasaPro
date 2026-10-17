"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { coletarNoticiasAgora } from "@/actions/admin-noticias.actions";
import { chamarAction } from "@/lib/http/chamar-action";
import { Button } from "@/components/ui/button";

export function ColetarNoticias() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function coletar() {
    setBusy(true);
    const res = await chamarAction(() => coletarNoticiasAgora(undefined));
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `${res.data.novas} notícia(s) nova(s) · ${res.data.feeds - res.data.falhas}/${res.data.feeds} feeds responderam`,
    );
    router.refresh();
  }
  return (
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={coletar}>
      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      Coletar agora
    </Button>
  );
}
