import type { Metadata } from "next";
import { LEGAL_ENTITY, TERMS_UPDATED_AT, TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Política de Privacidade — CeasaPro",
  description:
    "Como o CeasaPro coleta, usa, compartilha e protege os dados pessoais, conforme a LGPD.",
};

/** Página estática: sem dados, sem sessão — pode ser cacheada pelo CDN. */
export default function PrivacidadePage() {
  return (
    <>
      <h1 className="text-2xl font-bold text-primary">Política de Privacidade</h1>
      <p className="text-muted-foreground">
        Versão {TERMS_VERSION} · Atualizado em {TERMS_UPDATED_AT}
      </p>
      <p>
        Esta política explica como o CeasaPro trata dados pessoais, em conformidade com a Lei Geral
        de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>

      <h2 className="mt-4 text-lg font-semibold">1. Quem é o controlador</h2>
      <p>
        O <strong>{LEGAL_ENTITY.name}</strong> é o controlador dos dados de cadastro e de cobrança
        da empresa assinante. Contato do encarregado de proteção de dados:{" "}
        <strong>{LEGAL_ENTITY.privacyEmail}</strong>.
      </p>
      <p>
        Quanto aos dados que <em>você</em> lança no sistema sobre os seus clientes e fornecedores
        (por exemplo, para controlar o fiado), <strong>o controlador é a sua empresa</strong> — o
        CeasaPro atua como operador, tratando esses dados apenas para executar o serviço conforme
        suas instruções.
      </p>

      <h2 className="mt-4 text-lg font-semibold">2. Quais dados coletamos</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Cadastro da empresa:</strong> nome fantasia, razão social, CNPJ, telefone,
          endereço e horário de funcionamento.
        </li>
        <li>
          <strong>Usuário responsável:</strong> nome, e-mail e senha (armazenada apenas como hash
          Argon2 — não temos como ler sua senha).
        </li>
        <li>
          <strong>Dados de assinatura:</strong> plano, valor, vencimento, histórico de pagamentos e
          identificadores da transação no Mercado Pago. <strong>Não armazenamos</strong> número,
          validade ou código de segurança de cartão.
        </li>
        <li>
          <strong>Dados operacionais lançados por você:</strong> produtos, compras, vendas,
          clientes de fiado, fornecedores, estoque, despesas e movimentações.
        </li>
        <li>
          <strong>Registros técnicos:</strong> endereço IP, data e hora de acesso, ações relevantes
          (trilha de auditoria) e data/IP do aceite dos Termos. A guarda desses registros atende ao
          art. 15 do Marco Civil da Internet e à sua própria segurança.
        </li>
      </ul>

      <h2 className="mt-4 text-lg font-semibold">3. Por que tratamos esses dados (base legal)</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Execução do contrato</strong> (art. 7º, V): criar e manter sua conta, processar a
          mensalidade, liberar e bloquear o acesso, prestar suporte.
        </li>
        <li>
          <strong>Cumprimento de obrigação legal</strong> (art. 7º, II): guarda de registros de
          acesso e de documentos financeiros pelos prazos exigidos em lei.
        </li>
        <li>
          <strong>Legítimo interesse</strong> (art. 7º, IX): segurança da plataforma, prevenção a
          fraude e melhoria do serviço, sempre respeitando suas expectativas e direitos.
        </li>
      </ul>

      <h2 className="mt-4 text-lg font-semibold">4. Com quem compartilhamos</h2>
      <p>
        Compartilhamos apenas o necessário, com operadores que também seguem a LGPD:{" "}
        <strong>Mercado Pago</strong> (processamento de pagamentos), <strong>Google</strong> (envio
        de e-mails transacionais por SMTP), <strong>Vercel</strong> (hospedagem) e{" "}
        <strong>Neon</strong> (banco de dados). Não vendemos nem cedemos seus dados para fins de
        publicidade. Dados podem ser fornecidos a autoridades mediante ordem legal.
      </p>

      <h2 className="mt-4 text-lg font-semibold">5. Isolamento entre empresas</h2>
      <p>
        O CeasaPro é multiempresa. Toda consulta ao banco é filtrada automaticamente pelo
        identificador da sua empresa, de modo que uma empresa não acessa dados de outra — nem por
        erro de programação, nem por manipulação de requisição.
      </p>

      <h2 className="mt-4 text-lg font-semibold">6. Segurança</h2>
      <ul className="list-disc pl-5">
        <li>Tráfego cifrado por HTTPS, com HSTS em produção.</li>
        <li>Senhas protegidas com Argon2; sessões em cookies httpOnly e de curta duração.</li>
        <li>Revogação imediata das sessões em caso de bloqueio, estorno ou troca de senha.</li>
        <li>Trilha de auditoria imutável das ações relevantes.</li>
        <li>Webhooks de pagamento validados por assinatura HMAC com proteção contra replay.</li>
      </ul>

      <h2 className="mt-4 text-lg font-semibold">7. Por quanto tempo guardamos</h2>
      <p>
        Mantemos os dados enquanto a assinatura estiver ativa. Após o cancelamento, os dados
        operacionais ficam disponíveis por 90 dias para eventual exportação e depois são eliminados,
        exceto os registros que a lei nos obriga a conservar (financeiros e de acesso), guardados
        pelo prazo legal correspondente.
      </p>

      <h2 className="mt-4 text-lg font-semibold">8. Seus direitos</h2>
      <p>
        A LGPD garante a você: confirmação da existência de tratamento, acesso aos dados, correção
        de dados incompletos ou desatualizados, anonimização ou eliminação de dados desnecessários,
        portabilidade, informação sobre compartilhamentos e revogação do consentimento.
      </p>
      <p>
        Para exercer qualquer um deles, escreva para <strong>{LEGAL_ENTITY.privacyEmail}</strong>.
        Respondemos em até 15 dias. Boa parte dos dados você também consegue corrigir sozinho em
        &quot;Configurações&quot; dentro do sistema.
      </p>

      <h2 className="mt-4 text-lg font-semibold">9. Cookies</h2>
      <p>
        Usamos apenas cookies essenciais: os que mantêm você autenticado (sessão e renovação de
        sessão). Não usamos cookies de publicidade nem de rastreamento entre sites.
      </p>

      <h2 className="mt-4 text-lg font-semibold">10. Alterações desta política</h2>
      <p>
        Mudanças são publicadas nesta página com nova data de atualização e, quando relevantes,
        comunicadas por e-mail. Dúvidas: <strong>{LEGAL_ENTITY.privacyEmail}</strong>.
      </p>
    </>
  );
}
