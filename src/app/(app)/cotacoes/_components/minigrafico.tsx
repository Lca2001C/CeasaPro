import { trilhaDoMinigrafico } from "@/lib/cotacoes/variacao";

/**
 * O desenho da série recente, do tamanho de um selo, no canto do cartão.
 *
 * SVG escrito à mão, sem biblioteca de gráfico, pelo mesmo motivo de
 * `sales-chart.tsx`: o app é aberto no celular, dentro do galpão do CEASA, em
 * rede ruim. Uma lib de gráfico custaria mais bytes que a tela inteira para
 * desenhar oito pontos.
 *
 * `aria-hidden` porque não há informação aqui que o texto do cartão já não diga
 * — preço, preço anterior e variação estão todos escritos ao lado. Um leitor de
 * tela anunciando "gráfico" só atrasaria a leitura do que importa.
 */

const LARGURA = 56;
const ALTURA = 16;

export function Minigrafico({ valores }: { valores: number[] }) {
  const trilha = trilhaDoMinigrafico(valores, LARGURA, ALTURA);
  // Menos de dois pontos não é tendência; o espaço fica vazio em vez de mostrar
  // um traço reto que sugeriria estabilidade medida.
  if (!trilha) return null;

  return (
    <svg
      // A caixa é 1px maior de cada lado: com `viewBox` colado nos extremos, a
      // metade externa do traço nos pontos de mínimo e máximo fica cortada.
      viewBox={`-1 -1 ${LARGURA + 2} ${ALTURA + 2}`}
      width={LARGURA}
      height={ALTURA}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <polyline
        points={trilha}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
