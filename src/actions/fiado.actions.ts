"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { FiadoService } from "@/lib/services/fiado.service";
import {
  fiadoUpdateSchema,
  devolucaoCaixasSchema,
  cancelarFiadoSchema,
  estornoRecebimentoSchema,
} from "@/lib/validations/fiado";

export const atualizarFiado = withTenantAction({
  schema: fiadoUpdateSchema,
  handler: (input, ctx) => FiadoService.update(input, ctx),
});

/** Cancela a venda do fiado (estoque e caixas voltam). Ver `FiadoService.cancelarVendaDoFiado`. */
export const cancelarVendaDoFiado = withTenantAction({
  schema: cancelarFiadoSchema,
  handler: (input, ctx) => FiadoService.cancelarVendaDoFiado(input, ctx),
});

/**
 * Estorno de recebimento lançado errado. Server Action pelo mesmo motivo de
 * `cancelarVenda`: é um botão com confirmação; a transação fica no serviço.
 */
export const estornarRecebimento = withTenantAction({
  schema: estornoRecebimentoSchema,
  handler: async (input, ctx) => {
    const conta = await FiadoService.estornarPagamento(input, ctx);
    return { id: conta.id, status: conta.status };
  },
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
 * `cancelarVendaDoFiado` NÃO leva o gate de propósito: ela só estorna caixas
 * que a venda levou, e a venda só leva caixa com o módulo. Cancelar uma venda é
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
