import { Skeleton } from "@/components/ui/skeleton";

/**
 * O contorno de uma tela de lista, enquanto o servidor responde.
 *
 * **Por que isto passou a existir.** O projeto tinha `Skeleton` pronto em
 * `ui/skeleton.tsx` e **zero usos**, e nenhum `loading.tsx` em toda a árvore.
 * O único estado de carregamento era o giro dentro do botão ao SALVAR — que
 * cobre a escrita e não cobre a leitura. Na prática: quem navegava de uma tela
 * para outra no 3G do galpão via a tela anterior congelada, sem nada indicando
 * que o toque tinha sido registrado. E o desfecho conhecido disso é tocar de
 * novo.
 *
 * **Por que imita a forma da tela, e não é um spinner.** Um bloco girando no
 * meio da página não diz o que vem; um contorno com cabeçalho e linhas diz
 * "está vindo uma lista" e reserva o espaço, então o conteúdo real não empurra
 * nada quando chega. Para quem tem pouca familiaridade com tecnologia, a
 * diferença entre "travou" e "está carregando" é essa.
 *
 * `aria-hidden` + `role="status"` no contêiner: o leitor de tela anuncia
 * "carregando" uma vez, em vez de ler doze caixas vazias.
 */
export function ListaSkeleton({
  linhas = 6,
  comFiltros = false,
}: {
  linhas?: number;
  /** Reserva a faixa de busca/filtros que a tela real tem acima da lista. */
  comFiltros?: boolean;
}) {
  return (
    <div role="status" aria-label="Carregando" className="flex flex-col gap-4">
      {/* Mesmo arranjo do PageHeader: empilhado no celular. */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-7 w-40 max-w-full" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
        <Skeleton className="h-11 w-28 shrink-0 rounded-full" aria-hidden="true" />
      </div>

      {comFiltros && <Skeleton className="h-10 w-full" aria-hidden="true" />}

      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: linhas }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Contorno de uma grade de cartões (o caso da tela de Cotações).
 *
 * Mede a mesma grade de 1/2/3 colunas da tela real: no celular a lista
 * empilhada do `ListaSkeleton` daria a impressão errada de layout e a página
 * "pularia" quando os cartões chegassem.
 */
export function GradeSkeleton({ cartoes = 9 }: { cartoes?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="flex flex-col gap-4">
      <div className="mb-4 flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-16 w-full" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: cartoes }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Contorno do Início. A tela soma dezenas de consultas (resumo, avisos, contas,
 * cotações) antes de aparecer; sem contorno, o toque em "Início" ficava sem
 * resposta até tudo terminar. Reserva os três cartões de ação e os números.
 */
export function InicioSkeleton() {
  return (
    <div role="status" aria-label="Carregando" className="flex flex-col gap-4">
      <div className="mb-1 flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-7 w-40 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full max-w-sm rounded-full" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-40 w-full" aria-hidden="true" />
    </div>
  );
}

/**
 * Contorno do PDV: busca e grade de produtos. Herdar o `ListaSkeleton` de
 * `/vendas` desenhava uma lista com filtros e a tela "pulava" quando a grade
 * chegava.
 */
export function PdvSkeleton() {
  return (
    <div role="status" aria-label="Carregando" className="flex flex-col gap-4">
      <Skeleton className="h-7 w-32" aria-hidden="true" />
      <Skeleton className="h-12 w-full" aria-hidden="true" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
