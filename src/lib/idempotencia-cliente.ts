/**
 * Chave de idempotência amarrada ao CONTEÚDO do envio — para formulários
 * (compra, fiado manual, recebimento).
 *
 * O mesmo conteúdo reenviado (toque duplo, retentativa depois de um timeout em
 * que o servidor gravou) usa a MESMA chave, e o servidor devolve o lançamento
 * já gravado em vez de duplicar. Conteúdo diferente ganha chave nova: antes a
 * chave sobrevivia à edição, e o lançamento corrigido depois do timeout era
 * "devolvido" como o antigo — nunca chegava a ser gravado. Pelo outro lado,
 * zerar a chave a cada tecla fazia o operador que redigitava o MESMO valor
 * depois do timeout gravar em dobro.
 *
 * O PDV não usa isto: lá duas vendas idênticas em sequência são normais, e a
 * chave é por carrinho (com a conferência do total na resposta).
 */
export type RefDeChave = { current: { conteudo: string; chave: string } | null };

export function chavePorConteudo(ref: RefDeChave, corpo: unknown): string {
  const conteudo = JSON.stringify(corpo);
  if (ref.current?.conteudo !== conteudo) {
    ref.current = { conteudo, chave: crypto.randomUUID() };
  }
  return ref.current.chave;
}
