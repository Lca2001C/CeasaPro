"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { AvisosService } from "@/lib/services/avisos.service";
import { formatBRL } from "@/lib/format";

export interface Notificacao {
  /** Identidade da notificação: muda quando o conteúdo muda (vira "novidade"). */
  id: string;
  titulo: string;
  detalhe: string | null;
  href: string;
}

/**
 * Sino do header: os mesmos avisos do Início e do push diário
 * (`AvisosService.get`, já filtrado pelos módulos do plano). Chamado pelo
 * cliente ao abrir o app, ao voltar para a aba e a cada poucos minutos — não
 * pelo layout, para não somar idas ao banco em toda navegação.
 */
export const listarNotificacoes = withTenantAction({
  handler: async (_input: void, ctx): Promise<Notificacao[]> => {
    const avisos = await AvisosService.get(ctx.tenantId, ctx.session.modules);
    return avisos.map((a) => ({
      id: `${a.tipo}:${a.count}:${a.label}`,
      titulo: a.label,
      detalhe: a.total ? formatBRL(a.total) : null,
      href: a.href,
    }));
  },
});
