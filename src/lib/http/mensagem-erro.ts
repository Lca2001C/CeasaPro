/**
 * A mensagem a mostrar para uma resposta de erro (rota ou Server Action).
 *
 * Falha de schema chega como `message: "Dados inválidos"` (ou "Verifique os
 * campos destacados") e o motivo de verdade em `fields` ("Informe a data",
 * "Quantidade muito alta"). Mostrar só a `message` deixava o operador sem saber
 * o que corrigir — e, sem campo destacado na tela, sem pista nenhuma.
 *
 * Só tipos: pode ser importado por componente cliente.
 */
export function mensagemDoErro(error: {
  code: string;
  message: string;
  fields?: Record<string, string>;
}): string {
  if (error.code === "VALIDATION" && error.fields) {
    const primeira = Object.values(error.fields).find((m) => typeof m === "string" && m.trim());
    if (primeira) return primeira;
  }
  return error.message;
}
