/**
 * Texto do resultado de "Replicar mês anterior": diz o que aconteceu com CADA
 * grupo de contas do mês de origem.
 *
 * Com `criadas === 0` a mensagem antiga era sempre "as N conta(s) já foram
 * replicadas" — falso quando parte delas (ou todas) era "Repetir todo mês", que
 * a replicação pula de propósito e que só gera a parcela seguinte ao vencer ou
 * ser quitada. O dono concluía que o mês seguinte já estava lançado.
 */
export function mensagemReplicacao(
  r: { criadas: number; jaCopiadas: number; recorrentes: number },
  mesOrigem: string,
): string {
  const partes: string[] = [];
  if (r.criadas > 0) partes.push(`${r.criadas} conta(s) copiada(s) para o mês seguinte`);
  if (r.jaCopiadas > 0) partes.push(`${r.jaCopiadas} já tinha(m) cópia`);
  if (r.recorrentes > 0) {
    partes.push(
      `${r.recorrentes} é(são) automática(s) ("Repetir todo mês") e ganha(m) a parcela ` +
        "seguinte ao vencer ou ser paga",
    );
  }
  if (partes.length === 0) return `Nada a copiar de ${mesOrigem}`;
  const texto = partes.join("; ");
  return r.criadas > 0 ? texto : `Nada a copiar de ${mesOrigem}: ${texto}`;
}
