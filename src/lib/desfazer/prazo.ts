/**
 * A regra ÚNICA para desfazer um lançamento do balcão: venda (à vista, fiado
 * ou mista), compra e recebimento de fiado.
 *
 * Até {@link HORAS_PARA_DESFAZER} horas depois do REGISTRO, o lançamento pode
 * ser cancelado: ele fica na base marcado (auditoria e histórico), sai dos
 * totais, e o estoque, as caixas e o dinheiro voltam ao que eram. Depois disso,
 * ninguém desfaz — o fechamento daquele dia já foi conferido, entregue ao
 * contador, e reescrevê-lo em silêncio mudaria um número que alguém já usou.
 *
 * Antes cada operação tinha a sua: a venda à vista cancelava em 24 h, o fiado
 * sem pagamento era APAGADO a qualquer tempo (reescrevendo meses fechados), a
 * compra e o recebimento não tinham volta nenhuma.
 *
 * A janela conta do `createdAt`, nunca da data digitada (`saleDate`,
 * `purchaseDate`, `paidAt`): o lançamento com data de ontem nasceria sem prazo,
 * e um com data futura ganharia prazo até depois dela.
 */
export const HORAS_PARA_DESFAZER = 24;

/** O lançamento registrado em `registradoEm` ainda pode ser desfeito? */
export function dentroDoPrazoDeDesfazer(registradoEm: Date, agora = new Date()): boolean {
  return agora.getTime() <= registradoEm.getTime() + HORAS_PARA_DESFAZER * 3600_000;
}

/** Frase única para a recusa por prazo — `acao` é "cancelar esta venda"… */
export function foraDoPrazoDeDesfazer(acao: string): string {
  return (
    `Passou o prazo para ${acao}: um lançamento só pode ser desfeito até ` +
    `${HORAS_PARA_DESFAZER} h depois de registrado, e o fechamento daquele dia não é reescrito.`
  );
}
