"use server";

import { z } from "zod";
import { withTenantAction } from "@/lib/http/with-action";
import { PlanoService } from "@/lib/services/plano.service";

/** Troca o plano da empresa (OWNER). Módulo-núcleo: sem gate de módulo. */
export const trocarPlano = withTenantAction({
  schema: z.object({ planId: z.string().min(1) }),
  handler: (input, ctx) => PlanoService.changePlan(input.planId, ctx),
});
