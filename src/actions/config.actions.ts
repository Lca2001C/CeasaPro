"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { ConfigService } from "@/lib/services/config.service";
import { empresaSchema } from "@/lib/validations/config";

export const salvarEmpresa = withTenantAction({
  schema: empresaSchema,
  handler: (input, ctx) => ConfigService.updateCompany(input, ctx),
});

export const concluirOnboarding = withTenantAction({
  handler: (_input, ctx) => ConfigService.completeOnboarding(ctx),
});
