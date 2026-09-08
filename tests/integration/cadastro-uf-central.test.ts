import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { SignupService } from "@/lib/services/signup.service";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { cleanupTenants } from "../helpers/factory";
import { NOME_EMPRESA_PADRAO } from "@/lib/tenant-defaults";

/**
 * O que o cadastro coleta precisa CHEGAR no módulo.
 *
 * A escolha de estado e central no cadastro só vale a pena se o cliente abrir
 * Cotações no primeiro acesso e já ver o boletim da praça dele. Um campo que é
 * coletado e some no caminho é pior que campo nenhum: custa o toque de quem se
 * cadastra e não entrega nada.
 *
 * Estes testes seguem o caminho inteiro — formulário → serviço → banco → tela —
 * sem atalho.
 */

const uniq = () => `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
const CENTRAL = `UFT${uniq().slice(-5)}`.toUpperCase();
const tenants: string[] = [];
const emails: string[] = [];
const slugs: string[] = [];
let planoId = "";

const HOJE = new Date();
HOJE.setUTCHours(0, 0, 0, 0);

async function cadastrar(over: { uf?: string; ceasaCentralCode?: string } = {}) {
  const email = `uf-${uniq()}@teste-ceasapro.com.br`;
  emails.push(email);
  const res = await SignupService.register(
    { email, password: "senha1234", ...over },
    { ip: "203.0.113.50" },
  );
  if (res.tenantId) tenants.push(res.tenantId);
  return res;
}

beforeAll(async () => {
  const plano = await prisma.plan.create({
    data: { name: "Plano UF", slug: `plano-uf-${uniq()}`, priceMonthly: 79.9, active: true },
  });
  planoId = plano.id;

  await prisma.ceasaCentral.create({
    data: {
      code: CENTRAL,
      name: "Central do Teste de UF",
      city: "Cariacica",
      uf: "ES",
      sourceKey: "manual",
      maxDiasSemBoletim: 7,
    },
  });

  // Um boletim de hoje, para a tela ter o que mostrar.
  const slug = `abobora-do-teste-uf-${uniq()}`;
  slugs.push(slug);
  const produto = await prisma.ceasaProduct.create({
    data: { name: "ABOBORA DO TESTE UF", slug },
  });
  await prisma.ceasaQuote.create({
    data: {
      centralCode: CENTRAL,
      ceasaProductId: produto.id,
      quoteDate: HOJE,
      unit: "CX",
      refPrice: "42.00",
    },
  });
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaCentral.deleteMany({ where: { code: CENTRAL } });
  await prisma.ceasaProduct.deleteMany({ where: { slug: { in: slugs } } });
  await prisma.plan.deleteMany({ where: { id: planoId } });
});

describe("UF e central informadas no cadastro", () => {
  it("chegam na empresa", async () => {
    const res = await cadastrar({ uf: "ES", ceasaCentralCode: CENTRAL });
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: res.tenantId! } });

    expect(t.uf).toBe("ES");
    expect(t.ceasaCentralCode).toBe(CENTRAL);
    // O resto do cadastro mínimo continua valendo: nada mais foi pedido.
    expect(t.tradeName).toBe(NOME_EMPRESA_PADRAO);
    expect(t.phone).toBeNull();
  });

  /**
   * O teste que justifica o campo existir: o cliente abre Cotações e JÁ vê o
   * boletim da praça dele, sem passar por configuração nenhuma.
   */
  it("o módulo de Cotações já abre com a praça certa e com preço", async () => {
    const res = await cadastrar({ uf: "ES", ceasaCentralCode: CENTRAL });

    const painel = await CotacoesService.getPainel(res.tenantId!);
    expect(painel.central?.code).toBe(CENTRAL);
    expect(painel.central?.uf).toBe("ES");
    expect(painel.quoteDate).not.toBeNull();
    expect(painel.linhas.length).toBeGreaterThan(0);
    expect(Number(painel.linhas[0]!.refPrice)).toBe(42);
  });

  it("sem informar, a empresa nasce sem UF e sem central — e o módulo pede a escolha", async () => {
    const res = await cadastrar();
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: res.tenantId! } });
    expect(t.uf).toBeNull();
    expect(t.ceasaCentralCode).toBeNull();

    // A tela vira o formulário de escolha em vez de uma lista vazia.
    const painel = await CotacoesService.getPainel(res.tenantId!);
    expect(painel.central).toBeNull();
    expect(painel.linhas).toEqual([]);
  });

  /**
   * O cadastro é o caminho de AQUISIÇÃO: ele não pode ser perdido por causa de
   * um campo opcional. Uma central desativada entre carregar a página e enviar
   * o formulário é um caso real, e o desfecho certo é a conta existir sem
   * central — que a pessoa escolhe depois em dois toques.
   */
  it("central desconhecida é ignorada, e a conta é criada assim mesmo", async () => {
    const res = await cadastrar({ uf: "MG", ceasaCentralCode: "NAO-EXISTE-XPTO" });
    expect(res.outcome).toBe("created");

    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: res.tenantId! } });
    expect(t.ceasaCentralCode).toBeNull();
    // A UF veio do próprio schema e não depende do banco: continua gravada.
    expect(t.uf).toBe("MG");
  });

  it("central DESATIVADA também é ignorada, em vez de virar praça morta", async () => {
    const desativada = `OFF${uniq().slice(-5)}`.toUpperCase();
    await prisma.ceasaCentral.create({
      data: {
        code: desativada,
        name: "Central Desativada",
        city: "X",
        uf: "GO",
        sourceKey: "manual",
        active: false,
      },
    });

    const res = await cadastrar({ uf: "GO", ceasaCentralCode: desativada });
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: res.tenantId! } });
    expect(t.ceasaCentralCode).toBeNull();

    await prisma.ceasaCentral.delete({ where: { code: desativada } });
  });
});

describe("catálogo nacional", () => {
  it("cobre os 26 estados e o Distrito Federal", async () => {
    // O cadastro pergunta a UF e depois filtra as centrais por ela. Um estado
    // sem nenhuma central deixa a pessoa daquele estado sem opção nenhuma
    // depois de já ter escolhido o estado — beco sem saída no cadastro.
    const centrais = await CotacoesService.listarCentrais();
    const ufs = new Set(centrais.map((c) => c.uf));
    expect(ufs.size).toBeGreaterThanOrEqual(27);
  });

  it("as centrais com busca automática estão marcadas como tal", async () => {
    // Das 65, só 8 têm raspador. A tela usa isso para não prometer boletim que
    // não vem.
    const situacao = await CotacoesImportService.situacaoDasCentrais();
    const automaticas = situacao.filter((c) => c.sourceKey !== "manual");
    expect(automaticas.length).toBeGreaterThanOrEqual(8);
    // Grande BH e Grande Vitória são as duas medidas como diárias.
    const bh = situacao.find((c) => c.code === "CEAMG")!;
    expect(bh.sourceKey).toBe("ceasaminas");
    expect(bh.maxDiasSemBoletim).toBe(3);
  });

  it("o Espírito Santo entrou com fonte automática, sem adaptador novo", async () => {
    // Medido: o host da CEASAMINAS serve `mercod=211` como CEASA-ES Grande
    // Vitória. Cobrir o ES foi uma linha de catálogo.
    const es = await prisma.ceasaCentral.findUniqueOrThrow({ where: { code: "CEAES" } });
    expect(es.uf).toBe("ES");
    expect(es.sourceKey).toBe("ceasaminas");
    expect(es.sourceParams).toEqual({ mercado: "211" });
  });

  /**
   * A tela precisa saber se a central tem busca automática, porque a frase que
   * ela mostra muda: para as 8 automáticas cabe dizer "assim que o primeiro
   * boletim chegar"; para as 57 manuais isso seria prometer o que não vem.
   */
  it("o painel diz se a central tem busca automática", async () => {
    const manual = await cadastrar({ uf: "ES", ceasaCentralCode: CENTRAL });
    const pManual = await CotacoesService.getPainel(manual.tenantId!);
    expect(pManual.central?.automatica).toBe(false);

    // Grande BH tem raspador.
    const auto = await cadastrar({ uf: "MG", ceasaCentralCode: "CEAMG" });
    const pAuto = await CotacoesService.getPainel(auto.tenantId!);
    expect(pAuto.central?.automatica).toBe(true);
    // E o limiar de "boletim velho" é o dela, não um número global.
    expect(pAuto.central?.maxDiasSemBoletim).toBe(3);
  });

  it("Uberaba fica como manual — não devolveu boletim em 18 datas testadas", async () => {
    // Manual, e não desativada: um boxeiro de Uberaba precisa poder escolher a
    // central dele. Como manual, o cron não tenta e portanto não alarma.
    const uberaba = await prisma.ceasaCentral.findUniqueOrThrow({ where: { code: "CEARG" } });
    expect(uberaba.sourceKey).toBe("manual");
    expect(uberaba.active).toBe(true);
  });
});
