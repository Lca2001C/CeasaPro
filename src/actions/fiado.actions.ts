"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { FiadoService } from "@/lib/services/fiado.service";
import { fiadoUpdateSchema, devolucaoCaixasSchema } from "@/lib/validations/fiado";

export const atualizarFiado = withTenantAction({
  schema: fiadoUpdateSchema,
  handler: (input, ctx) => FiadoService.update(input, ctx),
});

/** Exclui o lançamento e desfaz a venda (estoque e caixas). Ver `FiadoService.remove`. */
export const excluirFiado = withTenantAction({
  schema: z.string().min(1),
  handler: (id, ctx) => FiadoService.remove(id, ctx),
});

export const registrarDevolucaoCaixas = withTenantAction({
  schema: devolucaoCaixasSchema,
  handler: async (input, ctx) => {
    const mov = await FiadoService.registrarDevolucaoCaixas(input, ctx);
    return { id: mov.id, quantity: mov.quantity };
  },
});
