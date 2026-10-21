"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Conteúdo de uma aba que só é montada quando a pessoa a abre: navega para a
 * URL da aba, e o servidor renderiza o conteúdo de verdade.
 *
 * Existe para "Meu plano" em /configuracoes: renderizado direto no
 * `TabsContent`, o Server Component do plano (`getPlanoView`, que aplica a troca
 * agendada, e `listAvailablePlans`) rodava em TODA visita a Configurações,
 * mesmo na aba Empresa — idas ao banco que ninguém via (briefing §13b).
 */
export function IrParaAba({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href, { scroll: false });
  }, [href, router]);
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Carregando…
    </p>
  );
}
