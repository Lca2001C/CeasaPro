"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { EstoqueService } from "@/lib/services/estoque.service";

/** Desfaz um ajuste manual lançado errado (até 24 h). Ver `EstoqueService.desfazerAjuste`. */
export const desfazerAjusteEstoque = withTenantAction({
  schema: z.object({ id: z.string().min(1) }),
  handler: (input, ctx) => EstoqueService.desfazerAjuste(input, ctx),
});
