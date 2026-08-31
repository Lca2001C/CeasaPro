/**
 * Trava de segurança: nenhum teste abre conexão SMTP.
 *
 * O `.env` do desenvolvedor é o mesmo arquivo usado para configurar o envio real
 * de e-mail. Bastava alguém preencher `SMTP_USER`/`SMTP_PASSWORD` para a suíte
 * passar a discar para o Gmail a cada teste que dispara e-mail — o que
 * (a) quebra os testes que declaram esperar o comportamento no-op, como
 * `billing-due-reminder`, (b) deixa a suíte dependente de rede e credencial, e
 * (c) na pior hipótese ENTREGA e-mail de teste na caixa de um cliente real,
 * porque as fixtures usam endereços que só por convenção são fictícios.
 *
 * O CI já roda sem essas variáveis de propósito (ver `ci.yml`). Isto faz o
 * ambiente local se comportar igual, em vez de depender de o `.env` estar "certo".
 *
 * `isEmailConfigured()` lê `SMTP_USER`/`SMTP_PASSWORD` em constantes de módulo,
 * avaliadas no import — por isso a limpeza acontece aqui, num `setupFile`, que
 * roda antes de qualquer módulo da aplicação ser carregado.
 *
 * Para testar o envio de verdade, faça-o fora da suíte (ex.: `npm run preflight`,
 * que valida a autenticação SMTP sem enviar mensagem).
 */
process.env.SMTP_USER = "";
process.env.SMTP_PASSWORD = "";
