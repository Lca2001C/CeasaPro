"use server";

import { withAdminAction } from "@/lib/http/with-action";
import { NoticiasService } from "@/lib/services/noticias.service";

/**
 * "Coletar agora" do CeasaNews, pelo super-admin: para conferir um feed que
 * falhou sem esperar o cron nem a próxima visita à tela.
 */
export const coletarNoticiasAgora = withAdminAction({
  handler: async () => NoticiasService.coletar({ prazo: Date.now() + 40_000 }),
});
