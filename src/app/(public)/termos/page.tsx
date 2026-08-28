import type { Metadata } from "next";
import { LEGAL_ENTITY, TERMS_UPDATED_AT, TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Termos de Uso — CeasaPro",
  description:
    "Termos de Uso do CeasaPro, sistema de gestão para comercializadores do CEASA.",
};

// Sem dados e sem sessão, mas renderizada por requisição para receber o nonce do
// CSP (ver `src/proxy.ts`): pré-renderizada, o HTML sairia sem nonce e a
// hidratação do React seria bloqueada pelo script-src.
export const dynamic = "force-dynamic";

export default function TermosPage() {
  return (
    <>
      <h1 className="text-2xl font-bold text-primary">Termos de Uso</h1>
      <p className="text-muted-foreground">
        Versão {TERMS_VERSION} · Atualizado em {TERMS_UPDATED_AT}
      </p>

      <h2 className="mt-4 text-lg font-semibold">1. Quem somos e o que é o CeasaPro</h2>
      <p>
        O CeasaPro é um sistema online de gestão voltado a comercializadores de hortifrúti que
        atuam em centrais de abastecimento (CEASA) e estabelecimentos similares. Ele organiza
        produtos, compras, vendas, vendas a prazo (fiado), estoque, caixas plásticas retornáveis,
        embalagens, despesas e relatórios do seu box.
      </p>
      <p>
        Ao contratar e usar o CeasaPro, você declara ter lido e aceito estes Termos de Uso e a{" "}
        <a href="/privacidade" className="text-primary underline">
          Política de Privacidade
        </a>
        . Se não concordar com algum ponto, não utilize o sistema.
      </p>

      <h2 className="mt-4 text-lg font-semibold">2. Cadastro e responsabilidade pela conta</h2>
      <p>
        Cada empresa contratante recebe um usuário responsável (dono). A senha inicial é temporária
        e deve ser trocada no primeiro acesso. Você é responsável por manter a confidencialidade das
        credenciais e por todas as operações realizadas com elas. Avise o suporte imediatamente em
        caso de suspeita de uso indevido.
      </p>
      <p>
        Os dados cadastrados devem ser verdadeiros e atualizados. Você se compromete a não usar o
        CeasaPro para fins ilícitos, nem a tentar acessar dados de outras empresas.
      </p>

      <h2 className="mt-4 text-lg font-semibold">3. Assinatura, pagamento e liberação do acesso</h2>
      <p>
        O CeasaPro é um serviço por assinatura mensal, <strong>pré-paga</strong>. Não há período de
        teste gratuito: o acesso às funcionalidades operacionais é liberado somente após a aprovação
        do primeiro pagamento.
      </p>
      <ul className="list-disc pl-5">
        <li>
          Os pagamentos são processados pelo <strong>Mercado Pago</strong>, nas modalidades PIX,
          cartão de crédito e cartão de débito. O CeasaPro não armazena números de cartão: os dados
          são enviados diretamente ao Mercado Pago e recebemos apenas um token de uso único.
        </li>
        <li>
          A liberação é automática assim que o Mercado Pago confirma a aprovação. Em PIX isso
          costuma levar poucos segundos; em cartão pode haver análise antifraude.
        </li>
        <li>
          A cada renovação, o vencimento avança um mês. O valor vigente é o do plano contratado no
          momento da renovação.
        </li>
        <li>
          Após o vencimento há um período de tolerância (informado na tela &quot;Meu plano&quot;)
          durante o qual o acesso continua liberado com aviso. Encerrada a tolerância, a conta é
          suspensa.
        </li>
      </ul>

      <h2 className="mt-4 text-lg font-semibold">4. Suspensão, estorno e chargeback</h2>
      <p>
        A conta é suspensa quando a mensalidade não é paga. Se um pagamento já aprovado for
        estornado, cancelado ou contestado junto ao emissor do cartão (chargeback), o período
        correspondente deixa de valer, o acesso é bloqueado de imediato e as sessões abertas são
        encerradas. No caso de chargeback, a reativação depende de análise, já que envolve uma
        disputa formal com a operadora.
      </p>
      <p>
        <strong>Seus dados são preservados durante a suspensão.</strong> Ao regularizar o pagamento,
        você volta a acessar tudo exatamente como estava.
      </p>

      <h2 className="mt-4 text-lg font-semibold">5. Cancelamento e reembolso</h2>
      <p>
        Você pode cancelar a assinatura a qualquer momento, sem multa. O cancelamento interrompe as
        renovações seguintes; o período já pago permanece disponível até o vencimento. Conforme o
        art. 49 do Código de Defesa do Consumidor, você pode desistir da contratação em até 7 dias
        corridos a partir do primeiro pagamento e receber o valor de volta.
      </p>
      <p>
        Antes de encerrar, exporte seus relatórios: mantemos os dados por um período limitado após o
        cancelamento (ver Política de Privacidade) e depois eles são eliminados.
      </p>

      <h2 className="mt-4 text-lg font-semibold">6. Disponibilidade e suporte</h2>
      <p>
        Trabalhamos para manter o serviço disponível de forma contínua, mas ele pode ficar
        indisponível por manutenção, falha de terceiros (provedor de nuvem, banco de dados, Mercado
        Pago) ou casos fortuitos. Não garantimos disponibilidade ininterrupta nem nos
        responsabilizamos por prejuízos decorrentes de indisponibilidade temporária.
      </p>
      <p>
        O suporte é prestado por WhatsApp e por e-mail ({LEGAL_ENTITY.supportEmail}), em dias úteis.
      </p>

      <h2 className="mt-4 text-lg font-semibold">7. Seus dados e seu conteúdo</h2>
      <p>
        As informações que você lança no sistema (produtos, vendas, clientes, fornecedores,
        estoque, financeiro) <strong>são suas</strong>. Nós as tratamos apenas para operar o serviço,
        conforme a Política de Privacidade, e cada empresa só enxerga os próprios dados.
      </p>
      <p>
        O CeasaPro é uma ferramenta de organização gerencial e{" "}
        <strong>não emite documentos fiscais</strong>. A responsabilidade por obrigações fiscais,
        tributárias e contábeis do seu negócio continua sendo integralmente sua.
      </p>

      <h2 className="mt-4 text-lg font-semibold">8. Propriedade intelectual</h2>
      <p>
        O software, a marca, o layout e a documentação do CeasaPro pertencem aos seus criadores. A
        assinatura concede uma licença de uso pessoal e intransferível, sem direito de copiar,
        modificar, redistribuir, revender ou fazer engenharia reversa do sistema.
      </p>

      <h2 className="mt-4 text-lg font-semibold">9. Limitação de responsabilidade</h2>
      <p>
        O CeasaPro é fornecido &quot;no estado em que se encontra&quot;. Nossa responsabilidade, em
        qualquer hipótese, fica limitada ao valor das mensalidades pagas nos 12 meses anteriores ao
        evento. Não respondemos por lucros cessantes ou por decisões comerciais tomadas com base nos
        relatórios do sistema — eles refletem os dados que você mesmo lançou.
      </p>

      <h2 className="mt-4 text-lg font-semibold">10. Mudanças nestes termos</h2>
      <p>
        Podemos revisar estes Termos para refletir mudanças no serviço ou na legislação. A versão
        vigente fica sempre nesta página, com a data de atualização. Alterações relevantes são
        comunicadas por e-mail e um novo aceite é solicitado no checkout seguinte.
      </p>

      <h2 className="mt-4 text-lg font-semibold">11. Foro e contato</h2>
      <p>
        Estes Termos são regidos pela legislação brasileira. Fica eleito o foro do domicílio do
        contratante para dirimir eventuais conflitos.
      </p>
      <p>
        Dúvidas sobre estes Termos: <strong>{LEGAL_ENTITY.supportEmail}</strong>.
      </p>
    </>
  );
}
