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

/**
 * Devolução de caixas plásticas lançada pela tela do fiado.
 *
 * Mora num arquivo de NÚCLEO mas escreve em `PlasticCrateMovement`, que é
 * recurso do módulo opcional — por isso o `module: "caixas"` aqui, apesar de
 * as outras actions deste arquivo não terem. É a mesma decisão que
 * `vendas.service.ts` já tomava para o mesmo recurso: empresa sem o módulo não
 * pode ter movimento de caixa criado pelas costas.
 *
 * Sem esta linha, quem não contratou era barrado por acidente — o invariante
 * de saldo recusa `RETORNO` acima do que o cliente tem, e quem não usa caixas
 * tem saldo zero. Funcionava, mas pelo motivo errado (relaxar aquele limite
 * abriria a porta em silêncio) e com a mensagem errada: a pessoa lia "Fulano
 * está com 0 caixa(s), confira o nome e a quantidade" e ia conferir o nome.
 *
 * `excluirFiado` NÃO leva o gate de propósito: ela APAGA movimentos de caixa
 * ao desfazer a venda, e apagar o que não existe é inócuo. Excluir um fiado é
 * núcleo, e exigir um módulo pago para isso tiraria a função de quem não o tem.
 */
export const registrarDevolucaoCaixas = withTenantAction({
  schema: devolucaoCaixasSchema,
  module: "caixas",
  handler: async (input, ctx) => {
    const mov = await FiadoService.registrarDevolucaoCaixas(input, ctx);
    return { id: mov.id, quantity: mov.quantity };
  },
});
