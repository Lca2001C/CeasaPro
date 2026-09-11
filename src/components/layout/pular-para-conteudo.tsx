/**
 * O primeiro link de toda página: pular a navegação e ir ao conteúdo.
 *
 * **Por que passou a existir.** A barra lateral tem 16 itens e o cabeçalho tem
 * mais alguns controles. Quem navega por teclado (Tab) ou por leitor de tela
 * atravessava TODOS eles antes de chegar ao conteúdo — em cada página, a cada
 * navegação. Não é um incômodo pontual: é um pedágio cobrado em toda troca de
 * tela, e é o motivo pelo qual este é o item mais antigo da lista de técnicas
 * da WCAG (2.4.1, "Bypass Blocks").
 *
 * **Por que fica invisível até receber foco.** Ele não é para quem usa o mouse;
 * mostrá-lo sempre gastaria a primeira linha de toda tela num controle que a
 * maioria nunca usa. `sr-only` tira do fluxo visual sem tirar da ordem de
 * tabulação — e `focus:not-sr-only` o traz de volta no instante em que o Tab
 * chega nele, que é exatamente quando alguém precisa dele.
 *
 * Um `sr-only` que ficasse `display: none` NÃO serviria: sairia também da
 * ordem de tabulação, e o link nunca receberia foco. É o erro comum aqui, e o
 * teste de acessibilidade cobra o comportamento (o link aparece ao receber
 * foco), não a classe.
 */
export function PularParaConteudo({ alvo = "conteudo" }: { alvo?: string }) {
  return (
    <a
      href={`#${alvo}`}
      className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      Pular para o conteúdo
    </a>
  );
}
