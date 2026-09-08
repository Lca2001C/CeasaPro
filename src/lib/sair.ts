import { encerrarSessao } from "./session-nav";

/**
 * Encerra a sessão e **avisa** quando não deu.
 *
 * Existe para os quatro botões de "Sair" não repetirem o mesmo `if`. O
 * reportador de erro vem por parâmetro (na prática, `toast.error`) para manter
 * `src/lib` sem dependência de UI, como já faz `api-client.ts`: a decisão de
 * como mostrar a mensagem é da tela.
 *
 * Sem isto o clique em "Sair" sem internet não fazia nada visível — nem sair,
 * nem avisar — e a pessoa ia embora achando que tinha saído.
 */
export async function sair(avisar: (mensagem: string) => void): Promise<void> {
  const resultado = await encerrarSessao();
  if (!resultado.ok && resultado.mensagem) avisar(resultado.mensagem);
}
