"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Config, DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import {
  assinarTour,
  encerrarTour,
  irParaTela,
  lerPosicao,
  tourParado,
} from "@/lib/tour/estado";
import {
  capitulosDoPlano,
  localizar,
  type Localizacao,
  type PassoTour,
} from "@/lib/tour/roteiro";

/**
 * Motor do tour guiado (driver.js).
 *
 * Vive no layout do app, ao lado da navegação, e renderiza `null`: o que ele faz
 * é destacar elementos das páginas que passam por baixo dele. Estar no layout é
 * o que permite o tour ATRAVESSAR telas — se ele estivesse numa página, cada
 * navegação o desmontaria.
 *
 * ## Como um tour de várias telas funciona aqui
 *
 * O driver.js destaca elementos que existem AGORA, no DOM. Um tour que passeia
 * por doze rotas não pode então ser uma lista única de passos: os elementos de
 * /compras não existem enquanto estamos em /produtos.
 *
 * A solução é um driver por CAPÍTULO (uma tela), e o efeito abaixo como máquina
 * de estados de duas regras:
 *
 * 1. A posição aponta para outra rota ⇒ navega. Nada mais.
 * 2. A posição aponta para a rota atual ⇒ monta o driver daquela tela.
 *
 * Avançar do último balão de uma tela só muda a posição; a regra 1 cuida da
 * navegação e a regra 2, do próximo capítulo. Assim não existe orquestração
 * imperativa de "navegar e depois esperar e depois destacar" — é a mesma
 * passagem de estado nos dois sentidos, o que também faz o botão Voltar
 * atravessar telas sem código próprio.
 *
 * ## Duas escolhas que não são do driver.js por padrão
 *
 * - **Tocar no escuro não fecha o tour.** O padrão da biblioteca é fechar, e no
 *   celular o dedo encosta fora do balão sem intenção — perder o tour por isso
 *   é frustrante. Sair continua a um toque, no X (e no Esc, no computador).
 * - **O elemento destacado não aceita clique** (`disableActiveInteraction`).
 *   Vários alvos são links de navegação; um toque neles levaria a pessoa para
 *   uma tela que não é a do capítulo e deixaria o tour falando de outra coisa.
 */

/** Classe do balão. O tema mora em `globals.css`. */
const CLASSE_BALAO = "tour-ceasapro";

/**
 * Quadros de espera por um alvo que ainda não está no DOM (~0,5s a 60fps).
 *
 * Na prática o efeito roda depois do commit da navegação e os elementos já
 * estão lá. A espera cobre o caso em que não estão: um destaque apontando para
 * o vazio confunde mais que meio segundo de atraso.
 */
const QUADROS_DE_ESPERA = 30;

/**
 * Primeiro elemento VISÍVEL entre os que o seletor casa.
 *
 * Existe por causa da navegação, que são dois elementos: a barra lateral
 * (escondida no celular) e a barra de baixo (escondida no computador). Um
 * `querySelector` simples devolveria a lateral em qualquer tamanho de tela,
 * porque ela vem primeiro no HTML — e o tour destacaria algo invisível.
 *
 * O teste é o mesmo que o driver.js usa internamente. `offsetParent` não serve:
 * ele é nulo também para elementos `position: fixed`, que é o caso da barra de
 * baixo.
 */
function alvoVisivel(seletor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(seletor)) {
    if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) return el;
  }
  return null;
}

function esperarAlvo(seletor: string): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let restantes = QUADROS_DE_ESPERA;
    const tentar = () => {
      const el = alvoVisivel(seletor);
      if (el || restantes-- <= 0) resolve(el);
      else requestAnimationFrame(tentar);
    };
    tentar();
  });
}

/**
 * Traduz um capítulo do roteiro para os passos do driver.js.
 *
 * `alvos` vem resolvido de fora (já esperado no DOM) e na mesma ordem dos
 * passos. Alvo nulo vira balão centralizado, sem destaque: é o que o primeiro
 * passo do tour usa de propósito, e o que salva a aparência caso um elemento
 * mude de lugar numa versão futura.
 */
function montarPassos(
  local: Localizacao,
  alvos: (HTMLElement | null)[],
): DriveStep[] {
  const { capitulo, deslocamento, total, proximaRota, rotaAnterior } = local;
  const ultimo = capitulo.passos.length - 1;

  return capitulo.passos.map((passo: PassoTour, i) => {
    const fimDaTela = i === ultimo;
    const fimDoTour = fimDaTela && proximaRota === null;

    return {
      element: alvos[i] ?? undefined,
      popover: {
        title: passo.titulo,
        description: passo.texto,
        side: passo.lado ?? "bottom",
        align: "start",
        // Progresso do tour INTEIRO. O contador do driver.js é por instância, e
        // como aqui há uma por tela, ele mostraria "1 de 2" em cada uma.
        progressText: `${deslocamento + i} de ${total}`,
        nextBtnText: fimDoTour ? "Terminar" : fimDaTela ? "Continuar" : "Avançar",
        prevBtnText: "Voltar",
        // O driver.js desabilita Voltar no primeiro passo da instância — correto
        // para ele, errado para nós: há tela anterior no roteiro. A configuração
        // do passo tem precedência sobre esse padrão.
        disableButtons: i === 0 && !rotaAnterior ? ["previous" as const] : [],
        ...(fimDaTela && {
          onNextClick: () => {
            if (proximaRota) irParaTela(proximaRota, "primeiro");
            else concluir();
          },
        }),
        ...(i === 0 &&
          rotaAnterior && {
            onPrevClick: () => irParaTela(rotaAnterior, "ultimo"),
          }),
      },
    };
  });
}

function concluir() {
  encerrarTour();
  toast.success("Tour concluído. Em Como usar você reencontra tudo isto escrito.");
}

const CONFIG_BASE: Config = {
  animate: true,
  showProgress: true,
  smoothScroll: true,
  allowClose: true,
  stagePadding: 8,
  stageRadius: 12,
  overlayOpacity: 0.65,
  popoverClass: CLASSE_BALAO,
  disableActiveInteraction: true,
  // Função vazia = tocar no escuro não faz nada. Ver o comentário do módulo.
  overlayClickBehavior: () => {},
};

export function TourGuiado({ modules }: { modules?: string[] }) {
  const posicao = useSyncExternalStore(assinarTour, lerPosicao, tourParado);
  const pathname = usePathname();
  const router = useRouter();

  /**
   * `modules` chega como array, e um array novo a cada render do layout refaria
   * o efeito — o que reiniciaria o capítulo no primeiro balão. A chave de texto
   * é o que estabiliza a dependência. `"*"` é o token legado, sem o claim de
   * módulos, que libera tudo (ver `isModuleEnabled`) e não pode ser confundido
   * com a lista vazia, que libera nada.
   */
  const chaveDoPlano = modules === undefined ? "*" : modules.join("|");
  const capitulos = useMemo(
    () =>
      capitulosDoPlano(
        chaveDoPlano === "*" ? undefined : chaveDoPlano.split("|").filter(Boolean),
      ),
    [chaveDoPlano],
  );

  useEffect(() => {
    if (!posicao) return;

    // Regra 1: o capítulo é de outra tela. Navega e deixa o próximo ciclo agir.
    if (posicao.rota !== pathname) {
      router.push(posicao.rota);
      return;
    }

    // Rota fora do roteiro — o plano perdeu o módulo, ou o roteiro mudou de uma
    // versão para outra. Encerra em paz, em vez de insistir numa tela que a
    // pessoa talvez não consiga nem abrir.
    const local = localizar(capitulos, posicao.rota);
    if (!local) {
      encerrarTour();
      return;
    }

    // Regra 2: monta o driver desta tela.
    let cancelado = false;
    let motor: { destroy: () => void } | null = null;

    void (async () => {
      const [{ driver }, alvos] = await Promise.all([
        // Carregado só aqui: 25 KB de biblioteca que quem nunca abre o tour não
        // precisa baixar — e no celular no box isso se sente.
        import("driver.js"),
        Promise.all(
          local.capitulo.passos.map((p) => (p.alvo ? esperarAlvo(p.alvo) : null)),
        ),
      ]);
      if (cancelado) return;

      const d = driver({
        ...CONFIG_BASE,
        steps: montarPassos(local, alvos),
        // Sair pelo X ou pelo Esc. O driver.js não desmonta nada quando este
        // gancho existe — a limpeza do efeito é que destrói, assim que o estado
        // mudar. `destroy()` aqui é a garantia de que o balão sai mesmo se o
        // efeito, por qualquer motivo, não voltar a rodar.
        onDestroyStarted: (_el, _passo, { driver: atual }) => {
          atual.destroy();
          encerrarTour();
        },
      });
      motor = d;
      d.drive(posicao.entrada === "ultimo" ? local.capitulo.passos.length - 1 : 0);
    })();

    return () => {
      cancelado = true;
      motor?.destroy();
    };
  }, [posicao, pathname, router, capitulos]);

  return null;
}
