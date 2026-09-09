import type { CeasaSerie } from "@prisma/client";

/**
 * A que taxonomia o dado de uma fonte pertence.
 *
 * `sourceKey` responde "quem busca"; `serie` responde "que tipo de número é
 * este". As duas divergem de propósito: um raspador novo do boletim de outra
 * praça seria um `sourceKey` novo na MESMA série CENTRAL, e comparar os dois
 * seria legítimo.
 *
 * Boletim colado à mão é CENTRAL: quem cola está transcrevendo o boletim de uma
 * praça, com os nomes específicos e a unidade que aquela praça usa.
 *
 * **Por que isto mora aqui, e não junto do importador.** A função é uma linha
 * pura, mas nasceu dentro de `cotacoes-import.service.ts` — que importa o
 * raspador (`@/lib/cotacoes/fontes`), o cliente HTTP e o serviço de notificação
 * do super-admin. Qualquer módulo de LEITURA que precisasse dela arrastava tudo
 * isso junto: o dashboard e a rota de snapshot do PWA passariam a carregar o
 * raspador para renderizar um preço. Separar custa um arquivo e resolve de vez.
 */
export function serieDaFonte(sourceKey: string): CeasaSerie {
  return sourceKey === "conab" ? "NACIONAL" : "CENTRAL";
}
