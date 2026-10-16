import type { OptionalModuleKey } from "@/lib/plan/modules";

/**
 * Conteúdo do guia, separado da tela.
 *
 * Fica como DADO, não como JSX, por dois motivos: quem for corrigir um texto
 * mexe aqui sem tocar em layout, e o campo `modulo` permite a página filtrar
 * pelo plano do cliente sem espalhar condicionais pelo meio da marcação.
 *
 * Regra ao editar: descreva o que o sistema FAZ, não o que se pretende que ele
 * faça. Cada "Atenção" abaixo corresponde a uma regra conferida no código —
 * texto de ajuda que promete o que o sistema não cumpre é pior que ausência de
 * ajuda, porque manda o cliente procurar o que não existe.
 */

export interface PassoInicial {
  titulo: string;
  texto: string;
  href: string;
}

/** A primeira semana. Sem isto nada mais funciona — o estoque nasce vazio. */
export const PRIMEIROS_PASSOS: PassoInicial[] = [
  {
    titulo: "1. Cadastre seus produtos",
    texto:
      "No Estoque, toque em Adicionar Novo Produto: nome, embalagem, preço de venda, " +
      "quanto já tem no box (com quanto custou) e uma foto — da câmera, da galeria ou " +
      "do banco de fotos.",
    href: "/estoque?novo=1",
  },
  {
    titulo: "2. Cadastre seus fornecedores",
    texto: "Quem te vende a mercadoria. Serve para acompanhar de quem você compra mais.",
    href: "/fornecedores/novo",
  },
  {
    titulo: "3. Registre a compra",
    texto:
      "No Estoque, toque em Registrar compra. A mercadoria entra no estoque e a conta " +
      "vai para Despesas, paga ou a pagar, com o fornecedor.",
    href: "/estoque/compra",
  },
  {
    titulo: "4. Faça a primeira venda",
    texto:
      "Na frente de caixa. O estoque baixa sozinho e o dia começa a aparecer no Início.",
    href: "/vendas/nova",
  },
];

export interface AreaGuia {
  titulo: string;
  href: string;
  /** Uma frase: para que serve. */
  resumo: string;
  /** Passo a passo curto do uso principal. */
  comoUsar: string[];
  /** Regra que costuma pegar o usuário de surpresa. Conferida no código. */
  atencao?: string;
  /** Definido = a área só aparece se o plano do cliente incluir este módulo. */
  modulo?: OptionalModuleKey;
}

export const AREAS: AreaGuia[] = [
  {
    titulo: "Vender (frente de caixa)",
    href: "/vendas/nova",
    resumo: "Onde você fecha a venda no balcão, com o cliente esperando.",
    comoUsar: [
      "Busque o produto e toque para colocar no carrinho.",
      "Ajuste a quantidade e o preço daquela venda, se precisar.",
      "Escolha como o cliente pagou: dinheiro, PIX, cartão ou fiado.",
      "Toque em finalizar. O estoque baixa na mesma hora.",
    ],
    atencao:
      "O sistema não deixa vender mais do que você tem em estoque — ele avisa qual " +
      "produto faltou e quanto ainda há. E se a forma de pagamento for FIADO, o nome " +
      "do cliente passa a ser obrigatório e a conta a receber é criada sozinha, sem " +
      "você precisar lançar nada na tela de Fiado.",
  },
  {
    titulo: "Fornecedores",
    href: "/fornecedores",
    resumo: "De quem você compra. Permite ver quanto passa por cada um.",
    comoUsar: [
      "Cadastre nome e telefone; o resto é opcional.",
      "Na tela do fornecedor você vê o histórico de compras dele.",
    ],
  },
  {
    titulo: "Vendas (histórico)",
    href: "/vendas",
    resumo: "Tudo o que você já vendeu, com cliente, forma de pagamento e total.",
    comoUsar: [
      "Use para conferir o movimento do dia ou achar uma venda específica.",
      "Para vender, use a frente de caixa — esta tela é só consulta.",
    ],
  },
  {
    titulo: "Fiado",
    href: "/fiado",
    resumo: "Quem te deve, quanto, desde quando e o que já pagou.",
    comoUsar: [
      "A conta aparece aqui sozinha quando você vende escolhendo FIADO.",
      "Abra a conta para ver os itens da compra e lançar pagamento.",
      "O pagamento pode ser parcial: informe o valor e o saldo é recalculado.",
      "Quando o pago alcança o total, a conta é marcada como quitada.",
    ],
    atencao:
      "Conta que já tem pagamento registrado NÃO pode ser excluída — apagar sumiria " +
      "com dinheiro que entrou no caixa. Se o valor está errado, acerte com o cliente " +
      "e registre. Sem nenhum pagamento, excluir desfaz a venda inteira: ela sai do " +
      "faturamento e a mercadoria volta para o estoque.",
  },
  {
    titulo: "Estoque (produtos e compras)",
    href: "/estoque",
    resumo:
      "Seus produtos, quanto tem de cada um, quanto isso vale — e as compras que " +
      "colocaram a mercadoria lá.",
    comoUsar: [
      "Adicionar Novo Produto: nome, embalagem, preço de venda, estoque inicial, alerta " +
        "de estoque e foto (câmera, galeria ou banco de fotos).",
      "Registrar compra: data, fornecedor, itens, frete e se pagou agora ou vai pagar " +
        "depois. O estoque sobe na hora.",
      "A aba Compras mostra o histórico e o que ainda está a pagar.",
      "Use Ajuste para registrar quebra, perda, doação ou uma correção de contagem.",
    ],
    atencao:
      "O saldo não é um número que se digita: é a soma de todas as entradas e saídas. " +
      "Para corrigir uma diferença, lance um Ajuste. O frete da compra é dividido entre " +
      "os itens conforme o valor de cada um, então o custo de cada caixa já vem com o " +
      "frete embutido. E produto com compra ou venda no histórico não é apagado de " +
      "verdade: sai das listas, para os relatórios antigos não mudarem.",
  },
  {
    titulo: "Despesas",
    href: "/despesas",
    resumo:
      "Funcionário, aluguel do box, embalagem — e as contas das compras de mercadoria, " +
      "com o fornecedor.",
    comoUsar: [
      "Lance com categoria, valor e vencimento.",
      "Marque se é fixa (todo mês) ou variável.",
      "Use as abas Pendentes / Pagas / Todas para filtrar, e o filtro Origem para ver " +
        "só as compras ou só as contas do dia a dia.",
      "Cada compra registrada no Estoque aparece aqui sozinha, marcada como Compra.",
    ],
    atencao:
      "Os três valores no topo somam TODAS as suas despesas, não só as que aparecem na " +
      "tela. É de propósito: o total devido não pode mudar só porque você filtrou a lista. " +
      "A conta de uma compra entra no que você deve e no caixa, mas não diminui o lucro " +
      "uma segunda vez: o custo da mercadoria já sai do lucro quando você vende.",
  },
  {
    titulo: "Relatórios",
    href: "/relatorios",
    resumo: "Vendas, compras, fiado, despesas e estoque no período que você escolher.",
    comoUsar: [
      "Escolha o relatório e o período.",
      "Baixe em Excel para mexer nos números, ou em PDF para imprimir e mandar ao contador.",
    ],
  },
  {
    titulo: "Caixas plásticas",
    href: "/caixas-plasticas",
    resumo: "Onde estão suas caixas retornáveis — e quantas não voltaram.",
    comoUsar: [
      "As caixas saem registradas na venda, junto com a mercadoria.",
      "Quando o cliente devolve, registre o retorno.",
      "Registre também a quebra, para o saldo não mentir.",
    ],
    atencao:
      "A caixa que volta do cliente volta SUJA. Ela só conta como limpa depois de passar " +
      "pela higienização. É por isso que os dois números aparecem separados: caixa suja " +
      "não sai em nova venda.",
    modulo: "caixas",
  },
  {
    titulo: "Higienização",
    href: "/higienizacao",
    resumo: "As caixas que foram lavar, e quanto isso está custando.",
    comoUsar: [
      "Registre o envio: quem lava, quantas caixas e o preço por caixa.",
      "Quando voltarem, registre o retorno — elas voltam para o estoque de limpas.",
      "Registre o pagamento do serviço para acompanhar o que ainda deve.",
    ],
    modulo: "higienizacao",
  },
  {
    titulo: "Venda de embalagens",
    href: "/embalagens",
    resumo: "Caixa de papelão, sacaria e afins vendidos à parte da mercadoria.",
    comoUsar: [
      "Cadastre os tipos de embalagem que você revende.",
      "Registre as vendas para essa receita não ficar de fora do resultado.",
    ],
    atencao:
      "Não confunda com caixa plástica: a plástica é sua e volta; a embalagem é vendida " +
      "e não volta.",
    modulo: "embalagens",
  },
  {
    titulo: "Cotações",
    href: "/cotacoes",
    resumo: "Os preços do boletim da sua central, com o que você tem em estoque destacado.",
    comoUsar: [
      "Escolha sua central do CEASA — os preços passam a ser os do boletim dela.",
      "Vincule cada produto seu ao produto correspondente do boletim. É uma vez só.",
      "Os produtos que você tem em estoque aparecem destacados na lista.",
    ],
    atencao:
      "É BOLETIM, não preço do momento: o preço de agora é negociado no balcão e nenhuma " +
      "central divulga. Cada praça publica em dias próprios — algumas todo dia útil, " +
      "outras duas ou três vezes por semana —, então a data do boletim fica sempre " +
      "visível no topo da tela, e quando o dado envelhece a tela avisa. A busca " +
      "automática cobre hoje as centrais de Minas e do Espírito Santo; nas demais, os " +
      "preços só aparecem se forem enviados manualmente. Use como referência, não como " +
      "o preço de agora.",
    modulo: "cotacoes",
  },
];

export interface Duvida {
  pergunta: string;
  resposta: string;
}

/** Dúvidas reais, com a resposta que corresponde ao comportamento do sistema. */
export const DUVIDAS: Duvida[] = [
  {
    pergunta: "O sistema não deixa eu vender, diz que falta estoque.",
    resposta:
      "O estoque daquele produto está abaixo da quantidade pedida. Lance a compra que " +
      "trouxe a mercadoria; se ela já está no box e nunca foi lançada, use " +
      "Estoque › Ajuste para registrar a entrada.",
  },
  {
    pergunta: "Vendi, mas o estoque não baixou.",
    resposta:
      "A baixa é automática ao finalizar a venda. Se não baixou, provavelmente a venda " +
      "não foi finalizada — confira se ela aparece em Vendas (histórico).",
  },
  {
    pergunta: "Errei uma venda no fiado. Como desfaço?",
    resposta:
      "Se a conta ainda não tem nenhum pagamento, abra o lançamento e exclua: o sistema " +
      "desfaz a venda inteira e devolve a mercadoria ao estoque. Se já tem pagamento, " +
      "não é possível excluir — o caminho é acertar o valor com o cliente e registrar.",
  },
  {
    pergunta: "Troquei de plano e o menu continua igual.",
    resposta:
      "A troca vale na hora. Se algum item não apareceu, saia e entre de novo para a " +
      "sessão ser renovada.",
  },
  {
    pergunta: "Meu teste grátis acabou e não consigo abrir as telas.",
    resposta:
      "Escolha um plano e pague em Assinatura. A liberação é automática assim que o " +
      "pagamento é aprovado, e tudo que você lançou durante o teste continua aqui.",
  },
  {
    pergunta: "Esqueci minha senha.",
    resposta:
      "Na tela de login, toque em Esqueci minha senha. Você recebe um link por e-mail " +
      "que vale por 1 hora.",
  },
  {
    pergunta: "Posso usar no celular?",
    resposta:
      "Sim — o sistema foi feito para o celular primeiro. No navegador do celular, use a " +
      "opção de instalar ou adicionar à tela de início para abrir como aplicativo.",
  },
];
