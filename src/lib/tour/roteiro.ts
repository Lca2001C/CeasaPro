/**
 * Roteiro do tour guiado — o que o tour mostra, em que ordem, e em que tela.
 *
 * Fica separado do motor (`components/tour/tour-guiado.tsx`) por dois motivos:
 * quem for corrigir um texto mexe só aqui, e a lógica de ordem/plano fica em
 * funções puras, cobertas por teste sem precisar de navegador.
 *
 * Três decisões que moldam o roteiro:
 *
 * 1. **Um capítulo por TELA.** O tour anda pelo app de verdade — a pessoa vê a
 *    tela dela, com os dados dela, e não uma sequência de imagens. Por isso o
 *    passo aponta para um elemento real, pelo atributo `data-tour`.
 *
 * 2. **A frente de caixa fica de fora.** É a única tela onde pode haver uma
 *    venda começada e um cliente esperando; cobrir isso com um balão modal é
 *    atrapalhar trabalho em andamento. O que ela faz é explicado no passo do
 *    botão "Nova venda", no Início, e o guia escrito (`/ajuda`) detalha o resto.
 *
 * 3. **Só o que o plano libera.** Capítulo com `modulo` desaparece de quem não
 *    contratou aquele módulo — explicar em detalhe uma tela que a pessoa não
 *    consegue abrir é fazer perder tempo. Quem quer saber o que existe fora do
 *    plano tem o bloco "Não incluído no seu plano" em `/ajuda`.
 *
 * Regra ao editar: descreva o que o sistema FAZ. Cada afirmação abaixo
 * corresponde a uma regra que existe no código e está documentada em
 * `src/app/(app)/ajuda/_conteudo.ts` — as duas fontes contam a mesma história.
 */
import { isModuleEnabled, type OptionalModuleKey } from "@/lib/plan/modules";

/** Um balão do tour. */
export interface PassoTour {
  /**
   * Seletor do elemento a destacar. Aceita alternativas separadas por vírgula e
   * vale a primeira VISÍVEL — é o que permite um único passo servir à barra de
   * baixo do celular e à barra lateral do desktop.
   *
   * Ausente = balão no meio da tela, sem destacar nada.
   */
  alvo?: string;
  titulo: string;
  texto: string;
  /** Lado do elemento em que o balão aparece. Padrão do motor: embaixo. */
  lado?: "top" | "right" | "bottom" | "left";
}

/** Uma tela do tour. */
export interface CapituloTour {
  /** Rota da tela. O motor navega até ela antes de mostrar os passos. */
  rota: string;
  /** Definido = o capítulo só existe se o plano incluir este módulo. */
  modulo?: OptionalModuleKey;
  passos: PassoTour[];
}

/** Alvo da navegação: barra de baixo no celular, barra lateral no desktop. */
const NAVEGACAO = '[data-tour="nav-mobile"], [data-tour="nav-desktop"]';
/** Título da tela — existe em toda página, via `PageHeader`. */
const TITULO = '[data-tour="titulo-da-tela"]';
/** Botão de ação do topo (Novo, Nova, Ajuste…) — também via `PageHeader`. */
const ACAO = '[data-tour="acao-da-tela"]';

export const CAPITULOS: CapituloTour[] = [
  {
    rota: "/dashboard",
    passos: [
      {
        titulo: "Vamos dar uma volta pelo sistema",
        texto:
          "Em uns três minutos você vê para que serve cada tela. Vou te levando — " +
          "basta ir tocando em Avançar. Pode sair quando quiser no X.",
      },
      {
        alvo: '[data-tour="dashboard-vender"]',
        titulo: "É daqui que sai a venda",
        texto:
          "A frente de caixa: você busca o produto, informa quanto e como o cliente " +
          "pagou, e finaliza. O estoque baixa na mesma hora. Não vou abrir agora para " +
          "não atrapalhar, mas é o botão que você mais vai usar.",
      },
      {
        alvo: '[data-tour="dashboard-numeros"]',
        titulo: "Os quatro números do dia",
        texto:
          "Quanto você vendeu hoje, quanto os clientes te devem, quanto vale sua " +
          "mercadoria e quanto sobrou no mês. Ninguém soma isso à mão: sai das compras " +
          "e vendas que você lança.",
      },
      {
        alvo: '[data-tour="dashboard-a-pagar"]',
        titulo: "O que vence nos próximos dias",
        texto:
          "Despesas e higienização somadas, com as contas mais próximas clicáveis. " +
          "Toque em uma para abrir e dar baixa.",
      },
      {
        alvo: '[data-tour="dashboard-detalhes"]',
        titulo: "O resto fica guardado aqui",
        texto:
          "Toque para abrir: vendas da semana e do mês, lucro bruto e margem. Logo " +
          "abaixo há outra seção com mais vendidos, produtos com prejuízo e estoque " +
          "parado. Ficam fechadas de propósito, para a tela abrir limpa no balcão.",
        lado: "top",
      },
      {
        alvo: NAVEGACAO,
        titulo: "Como andar pelo sistema",
        texto:
          "Por aqui você chega a todas as telas. No celular, o que não couber na barra " +
          "está em Mais. Agora vamos passar nelas, uma por uma.",
        lado: "top",
      },
    ],
  },
  {
    rota: "/produtos",
    passos: [
      {
        alvo: TITULO,
        titulo: "Produtos: a base de tudo",
        texto:
          "O que você comercializa. Sem produto cadastrado não há compra nem venda, " +
          "então é por aqui que se começa.",
      },
      {
        alvo: ACAO,
        titulo: "Nome e unidade de venda",
        texto:
          "É o mínimo para conseguir vender: tomate vendido em caixa, batata em saco, " +
          "queijo em kg. Se vende por caixa ou saco, informe quanto vai em cada um.",
      },
    ],
  },
  {
    rota: "/fornecedores",
    passos: [
      {
        alvo: TITULO,
        titulo: "De quem você compra",
        texto:
          "Nome e telefone bastam. Serve para abrir o fornecedor e ver o histórico de " +
          "compras dele — quanto passa por cada um.",
      },
    ],
  },
  {
    rota: "/compras",
    passos: [
      {
        alvo: TITULO,
        titulo: "Compra é o que enche o estoque",
        texto:
          "Toda mercadoria entra por aqui. O estoque nasce vazio, e o sistema não deixa " +
          "vender o que não entrou.",
      },
      {
        alvo: ACAO,
        titulo: "Itens e frete",
        texto:
          "Data, fornecedor, os itens com quantidade e preço pago, e o frete. O frete é " +
          "rateado entre os itens conforme o valor de cada um, então o custo da caixa já " +
          "vem com ele embutido — é o que faz o lucro sair certo, e não otimista.",
      },
    ],
  },
  {
    rota: "/estoque",
    passos: [
      {
        alvo: TITULO,
        titulo: "O saldo é calculado, não digitado",
        texto:
          "Cada número aqui é a soma das entradas e saídas daquele produto. Por isso " +
          "você pode abrir um produto e ver de onde veio cada movimento.",
      },
      {
        alvo: ACAO,
        titulo: "Quebra, perda e contagem",
        texto:
          "Quando a mercadoria estraga ou a contagem não fecha, lance um Ajuste. Assim " +
          "fica registrado o que aconteceu, em vez de o saldo mudar sem explicação.",
      },
    ],
  },
  {
    rota: "/vendas",
    passos: [
      {
        alvo: TITULO,
        titulo: "Tudo o que você já vendeu",
        texto:
          "Cliente, forma de pagamento e total de cada venda. Esta tela é de consulta — " +
          "para vender, use a frente de caixa.",
      },
    ],
  },
  {
    rota: "/fiado",
    passos: [
      {
        alvo: TITULO,
        titulo: "Quem te deve, e desde quando",
        texto:
          "A conta aparece aqui sozinha quando você fecha a venda escolhendo FIADO — " +
          "você não precisa lançar nada duas vezes.",
      },
      {
        alvo: ACAO,
        titulo: "O cliente pode pagar aos poucos",
        texto:
          "Abra a conta, informe o valor pago e o saldo é recalculado. Quando o pago " +
          "alcança o total, ela é marcada como quitada. Conta que já tem pagamento não " +
          "pode ser excluída: apagar sumiria com dinheiro que entrou no caixa.",
      },
    ],
  },
  {
    rota: "/despesas",
    passos: [
      {
        alvo: TITULO,
        titulo: "O que sai do caixa",
        texto:
          "Frete, funcionário, aluguel do box, embalagem, luz. É o que transforma o " +
          "lucro das vendas no dinheiro que realmente sobrou.",
      },
      {
        alvo: ACAO,
        titulo: "Fixa ou variável",
        texto:
          "Fixa é a que vem todo mês; variável muda. Os totais no topo somam TODAS as " +
          "suas despesas, mesmo as que o filtro esconde — o quanto você deve não pode " +
          "diminuir só porque você filtrou a lista.",
      },
    ],
  },
  {
    rota: "/caixas-plasticas",
    modulo: "caixas",
    passos: [
      {
        alvo: TITULO,
        titulo: "Suas caixas retornáveis",
        texto:
          "As que saem com a mercadoria e precisam voltar. Aqui você vê onde elas estão " +
          "e quantas não voltaram. A que volta do cliente volta SUJA: só conta como " +
          "limpa depois da higienização, e caixa suja não sai em nova venda.",
      },
    ],
  },
  {
    rota: "/higienizacao",
    modulo: "higienizacao",
    passos: [
      {
        alvo: TITULO,
        titulo: "As caixas que foram lavar",
        texto:
          "Quem lava, quantas caixas e o preço por caixa. Na devolução elas voltam ao " +
          "estoque de limpas, e o pagamento do serviço entra nas suas contas a pagar.",
      },
    ],
  },
  {
    rota: "/embalagens",
    modulo: "embalagens",
    passos: [
      {
        alvo: TITULO,
        titulo: "Papelão e sacaria vendidos à parte",
        texto:
          "Embalagem é vendida e não volta — diferente da caixa plástica, que é sua. " +
          "Registrar aqui evita que essa receita fique fora do resultado.",
      },
    ],
  },
  {
    rota: "/relatorios",
    passos: [
      {
        alvo: TITULO,
        titulo: "Para conferir e para o contador",
        texto:
          "Vendas, compras, fiado, despesas e estoque no período que você escolher. " +
          "Baixe em Excel para mexer nos números, ou em PDF para imprimir.",
      },
    ],
  },
  {
    rota: "/ajuda",
    passos: [
      {
        alvo: TITULO,
        titulo: "Tudo isto também está escrito",
        texto:
          "Tela por tela, com as regras que costumam pegar de surpresa e as dúvidas mais " +
          "comuns. Abre sem internet, para servir também quando algo dá errado no box.",
      },
      {
        alvo: '[data-tour="tutorial"]',
        titulo: "Pronto. É este o sistema.",
        texto:
          "O caminho é sempre o mesmo: lance a compra, lance a venda, e estoque, lucro, " +
          "fiado e relatórios saem calculados. O botão Tutorial no topo reabre este tour " +
          "e o guia escrito — e o WhatsApp no canto da tela fala com a gente.",
        lado: "bottom",
      },
    ],
  },
];

/** A primeira tela do tour. */
export const ROTA_INICIAL = CAPITULOS[0].rota;

/** Os capítulos que o plano do cliente libera, na ordem do roteiro. */
export function capitulosDoPlano(modules: string[] | undefined): CapituloTour[] {
  return CAPITULOS.filter((c) => !c.modulo || isModuleEnabled(modules, c.modulo));
}

/** Onde a tela atual fica dentro do tour inteiro. */
export interface Localizacao {
  capitulo: CapituloTour;
  /**
   * Número do primeiro passo do capítulo, 1-based, contado no tour INTEIRO.
   *
   * O motor cria um driver.js por capítulo (os passos de uma tela só existem
   * quando aquela tela está montada), e o contador dele seria local — "1 de 2"
   * repetido em cada tela. Este deslocamento é o que permite exibir "9 de 21" e
   * a pessoa saber quanto falta.
   */
  deslocamento: number;
  /** Total de passos do tour inteiro, já filtrado pelo plano. */
  total: number;
  /** Próxima tela do tour, ou null se este é o último capítulo. */
  proximaRota: string | null;
  /** Tela anterior, ou null se este é o primeiro capítulo. */
  rotaAnterior: string | null;
}

/**
 * Localiza a rota no roteiro.
 *
 * Devolve null quando a rota não é um capítulo — inclusive quando ela SAIU do
 * roteiro por causa do plano. É o que faz o tour terminar em paz em vez de
 * insistir numa tela que a pessoa não pode abrir.
 */
export function localizar(
  capitulos: CapituloTour[],
  rota: string,
): Localizacao | null {
  const indice = capitulos.findIndex((c) => c.rota === rota);
  if (indice === -1) return null;

  return {
    capitulo: capitulos[indice],
    deslocamento:
      capitulos.slice(0, indice).reduce((soma, c) => soma + c.passos.length, 0) + 1,
    total: capitulos.reduce((soma, c) => soma + c.passos.length, 0),
    proximaRota: capitulos[indice + 1]?.rota ?? null,
    rotaAnterior: capitulos[indice - 1]?.rota ?? null,
  };
}
