"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { tipoEmbalagemSchema, vendaEmbalagemSchema } from "@/lib/validations/embalagem";

export const criarTipoEmbalagem = withTenantAction({
  schema: tipoEmbalagemSchema,
  module: "embalagens",
  handler: (input, ctx) => EmbalagensService.createType(input, ctx),
});

export const criarVendaEmbalagem = withTenantAction({
  schema: vendaEmbalagemSchema,
  module: "embalagens",
  handler: (input, ctx) => EmbalagensService.createSale(input, ctx),
});

export const excluirVendaEmbalagem = withTenantAction({
  schema: z.string().min(1),
  module: "embalagens",
  handler: (id, ctx) => EmbalagensService.removeSale(id, ctx),
});
