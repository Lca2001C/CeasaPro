"use server";

import { z } from "zod";
import { withAdminAction } from "@/lib/http/with-action";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { lerCsvDeCotacoes } from "@/lib/cotacoes/csv";
import { parseFormDateTz } from "@/lib/tz";
import { BusinessRuleError } from "@/lib/http/app-error";

const importarSchema = z.object({
  centralCode: z.string().trim().min(1, "Escolha a central").max(20),
  quoteDate: z.string().trim().min(1, "Informe a data do boletim"),
  // Um boletim grande tem centenas de linhas; o teto existe para não aceitar um
  // arquivo inteiro colado por engano.
  texto: z.string().min(1, "Cole o boletim").max(500_000, "Texto grande demais"),
});

/**
 * Importação manual de boletim, pelo super-admin.
 *
 * Grava pelo MESMO serviço do importador automático, então o dado que chega por
 * aqui é indistinguível na tela do cliente — só a origem fica registrada em
 * `CeasaImportRun.sourceKey`.
 */
export const importarBoletimManual = withAdminAction({
  schema: importarSchema,
  handler: async (input) => {
    const { linhas, erros } = lerCsvDeCotacoes(input.texto);
    if (linhas.length === 0) {
      throw new BusinessRuleError(
        erros.length > 0
          ? `Nenhuma linha válida. Primeiro problema: linha ${erros[0]!.linha} — ${erros[0]!.motivo}.`
          : "Nenhuma linha encontrada no texto colado.",
      );
    }

    const r = await CotacoesImportService.gravar({
      centralCode: input.centralCode,
      // `parseFormDateTz` é obrigatório para data vinda de `<input type="date">`:
      // `new Date("2026-09-10")` é meia-noite UTC, que no Brasil é o dia 9.
      quoteDate: parseFormDateTz(input.quoteDate),
      linhas,
      sourceKey: "manual",
    });

    return { ...r, ignoradas: erros.length, primeirosErros: erros.slice(0, 5) };
  },
});
