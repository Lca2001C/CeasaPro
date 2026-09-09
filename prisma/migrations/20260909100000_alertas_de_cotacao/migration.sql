-- Alertas de flutuação de preço: "me avise se a batata subir mais de 10%".
--
-- É o segundo (e último) modelo do módulo de cotações com `tenantId`. As
-- tabelas de praça, produto do boletim e cotação são globais de propósito — o
-- preço da praça é o mesmo para todo mundo que compra ali. Já "quero ser
-- avisado" é decisão de UMA empresa, como o vínculo em `tenant_ceasa_links`.
--
-- Por que a UNIDADE entra na chave, junto com o produto
--
-- O boletim cota o mesmo item em embalagens diferentes, com preços de ordem de
-- grandeza diferente: medido no boletim real da CEASAMINAS, o tomate sai por
-- quilo e por caixa na mesma publicação. Um teto de R$ 5,00 é barato para a
-- caixa e caro para o quilo — a mesma linha não pode valer para as duas. Sem a
-- unidade na chave, o alerta compararia embalagens e mandaria "subiu 1.900%"
-- toda vez que a praça publicasse a outra.
--
-- Por que o limiar é POR ALERTA, e não uma constante
--
-- A tolerância pertence ao produto. Cebola e tomate oscilam vários por cento
-- entre boletins como comportamento normal de mercado; batata e cenoura são bem
-- mais estáveis. Um limiar único faria a cebola avisar quase todo dia — e um
-- alarme que toca todo dia é desligado pelo usuário em uma semana, levando
-- junto o aviso da alta de 30% que ele existe para pegar.
--
-- Sobre `variacaoMinima Decimal(5,2)`: cabe de 0,01% a 999,99%. Percentual, não
-- dinheiro, mas continua `Decimal` pela mesma razão de sempre neste projeto —
-- ponto flutuante não entra em regra de negócio.
CREATE TABLE "tenant_ceasa_alertas" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "ceasaProductId" TEXT NOT NULL,
  "unit"           TEXT NOT NULL DEFAULT '',
  "variacaoMinima" DECIMAL(5,2) NOT NULL,
  "precoTeto"      DECIMAL(14,2),
  "precoPiso"      DECIMAL(14,2),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_ceasa_alertas_pkey" PRIMARY KEY ("id")
);

-- Reconfigurar o alerta do mesmo item ATUALIZA em vez de empilhar. Sem isto, um
-- duplo toque no botão criaria dois alertas iguais e o comerciante receberia o
-- mesmo aviso duas vezes, sem ter como saber por quê.
CREATE UNIQUE INDEX "tenant_ceasa_alertas_tenantId_ceasaProductId_unit_key"
  ON "tenant_ceasa_alertas" ("tenantId", "ceasaProductId", "unit");

-- O caminho de leitura é sempre "os alertas DESTA empresa": tanto o cálculo do
-- aviso diário quanto a tela de gestão partem do tenant.
CREATE INDEX "tenant_ceasa_alertas_tenantId_idx"
  ON "tenant_ceasa_alertas" ("tenantId");

-- CASCATA nos dois lados, e é o que se quer nos dois casos: empresa excluída
-- não deixa alerta órfão, e produto do boletim removido do catálogo não deixa
-- alerta apontando para o vazio (que viraria um aviso que nunca dispara, sem
-- nada explicando).
ALTER TABLE "tenant_ceasa_alertas"
  ADD CONSTRAINT "tenant_ceasa_alertas_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_ceasa_alertas"
  ADD CONSTRAINT "tenant_ceasa_alertas_ceasaProductId_fkey"
  FOREIGN KEY ("ceasaProductId") REFERENCES "ceasa_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
