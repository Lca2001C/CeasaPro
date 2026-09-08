/**
 * A URL da lista de despesas a partir dos filtros escolhidos.
 *
 * Fica fora do componente por um motivo prático: é aqui que o recorte da aba
 * pode ser perdido, e um teste que roda em milissegundos vale mais que um
 * clique manual para garantir que não seja.
 *
 * O contrato com o servidor (`/despesas`): a aba **Vencidas** se identifica por
 * `vencidas=1` — o servidor traduz isso em `status: PENDENTE` mais o corte de
 * data —, e as outras abas por `status`. Emitir `status=PENDENTE` no lugar de
 * `vencidas=1` não dá erro: devolve silenciosamente TODAS as pendentes,
 * inclusive as que vencem no futuro, que é o pior resultado possível para quem
 * abriu a tela para saber o que está atrasado.
 */

export interface FiltrosDespesa {
  status: string;
  /** Recorte "o que está atrasado" (aba Vencidas). */
  vencidas: boolean;
  q: string;
  type: string;
  categoryId: string;
  dateField: string;
  from: string;
  to: string;
}

/** URL com busca e filtros aplicados, preservando a aba. */
export function urlDeDespesas(f: FiltrosDespesa): string {
  const params = new URLSearchParams();
  if (f.vencidas) params.set("vencidas", "1");
  else params.set("status", f.status || "PENDENTE");
  if (f.q) params.set("q", f.q);
  if (f.type) params.set("type", f.type);
  if (f.categoryId) params.set("categoria", f.categoryId);
  if (f.from || f.to) {
    params.set("campo", f.dateField || "dueDate");
    if (f.from) params.set("de", f.from);
    if (f.to) params.set("ate", f.to);
  }
  params.set("pagina", "1");
  return `/despesas?${params.toString()}`;
}

/** URL sem nenhum filtro — mas ainda na mesma aba. */
export function urlDeDespesasSemFiltros(f: Pick<FiltrosDespesa, "status" | "vencidas">): string {
  const aba = f.vencidas ? "vencidas=1" : `status=${f.status || "PENDENTE"}`;
  return `/despesas?${aba}&pagina=1`;
}
