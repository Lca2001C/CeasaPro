"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { FiadoService } from "@/lib/services/fiado.service";
import { fiadoUpdateSchema, devolucaoCaixasSchema } from "@/lib/validations/fiado";

export const atualizarFiado = withTenantAction({
  schema: fiadoUpdateSchema,
  handler: (input, ctx) => FiadoService.update(input, ctx),
});

export const registrarDevolucaoCaixas = withTenantAction({
  schema: devolucaoCaixasSchema,
  handler: async (input, ctx) => {
    const mov = await FiadoService.registrarDevolucaoCaixas(input, ctx);
    return { id: mov.id, quantity: mov.quantity };
  },
});
