import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CotacoesEnvioService } from "@/lib/services/cotacoes-envio.service";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import {
  createTestTenant,
  cleanupTenants,
  makeAdminCtx,
  makeCtx,
} from "../helpers/factory";

/**
 * O boletim que o CLIENTE envia, e a fila que o super-admin publica.
 *
 * O que estes testes guardam é a razão de a fila existir: `ceasa_quotes` é
 * tabela GLOBAL, lida por todos os clientes da mesma praça, e `gravar`
 * sobrescreve o que já está lá. Enquanto o envio está na fila ele tem de ser
 * invisível para os outros — é essa invisibilidade que permite o recurso existir
 * sem um tenant escrever em tabela compartilhada.
 */

const uniq = () => Math.random().toString(36).slice(2, 10);
const MANUAL = `ENVM${uniq().slice(0, 4)}`.toUpperCase();
const AUTOMATICA = `ENVA${uniq().slice(0, 4)}`.toUpperCase();
const centraisCriadas = [MANUAL, AUTOMATICA];

const tenants: string[] = [];
let cliente = "";
let vizinho = "";
let comRaspador = "";
let semCentral = "";

const HOJE = new Date();
HOJE.setUTCHours(0, 0, 0, 0);
/** Ontem, porque boletim com data futura é recusado na validação da action. */
const DIA = new Date(HOJE.getTime() - 24 * 60 * 60 * 1000);

const BOLETIM = `TOMATE SALADA;KG;4,00;4,25;4,50
ALFACE CRESPA;DZ;25,00;25,00;30,00`;

beforeAll(async () => {
  await prisma.ceasaCentral.createMany({
    data: [
      { code: MANUAL, name: "Praca Manual", city: "Divinopolis", uf: "MG", sourceKey: "manual" },
      {
        code: AUTOMATICA,
        name: "Praca Automatica",
        city: "Contagem",
        uf: "MG",
        sourceKey: "ceasaminas",
      },
    ],
  });

  cliente = await createTestTenant(`Cliente Envio ${uniq()}`);
  vizinho = await createTestTenant(`Vizinho Envio ${uniq()}`);
  comRaspador = await createTestTenant(`Com Raspador ${uniq()}`);
  semCentral = await createTestTenant(`Sem Central Envio ${uniq()}`);
  tenants.push(cliente, vizinho, comRaspador, semCentral);

  // Cliente e vizinho compram na MESMA praça manual: é o par que expõe
  // vazamento se o rascunho não for isolado.
  await prisma.tenant.updateMany({
    where: { id: { in: [cliente, vizinho] } },
    data: { ceasaCentralCode: MANUAL },
  });
  await prisma.tenant.update({
    where: { id: comRaspador },
    data: { ceasaCentralCode: AUTOMATICA },
  });
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: { in: centraisCriadas } } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: { in: centraisCriadas } } });
  await prisma.ceasaProduct.deleteMany({ where: { quotes: { none: {} }, links: { none: {} } } });
  await prisma.ceasaCentral.deleteMany({ where: { code: { in: centraisCriadas } } });
});

describe("quem pode enviar", () => {
  it("praça sem busca automática aceita", async () => {
    const r = await CotacoesEnvioService.enviar(
      { quoteDate: DIA, texto: BOLETIM },
      makeCtx(cliente),
    );
    expect(r.linhasValidas).toBe(2);
    expect(r.ignoradas).toBe(0);
  });

  it("praça COM busca automática recusa, e diz por quê", async () => {
    /*
      Não é desconfiança do cliente. Os dois caminhos gravariam a mesma data,
      `gravar` sobrescreve, e o preço passaria a mudar conforme quem chegou por
      último — comportamento impossível de explicar olhando a tela.
    */
    await expect(
      CotacoesEnvioService.enviar({ quoteDate: DIA, texto: BOLETIM }, makeCtx(comRaspador)),
    ).rejects.toThrow(/já tem busca automática/i);
  });

  it("sem central escolhida, recusa antes de qualquer coisa", async () => {
    await expect(
      CotacoesEnvioService.enviar({ quoteDate: DIA, texto: BOLETIM }, makeCtx(semCentral)),
    ).rejects.toThrow(/central/i);
  });

  it("texto sem nenhuma linha válida não entra na fila", async () => {
    // Fazer duas pessoas descobrirem o mesmo erro em momentos diferentes é o
    // desfecho que isto evita: o cliente vê agora, não depois do operador.
    const antes = await prisma.tenantBoletimEnviado.count({ where: { tenantId: cliente } });
    await expect(
      CotacoesEnvioService.enviar(
        { quoteDate: DIA, texto: "isto não é boletim nenhum" },
        makeCtx(cliente),
      ),
    ).rejects.toThrow(/nenhuma linha/i);
    expect(await prisma.tenantBoletimEnviado.count({ where: { tenantId: cliente } })).toBe(antes);
  });
});

describe("o rascunho é invisível para os outros", () => {
  /**
   * A garantia central deste arquivo.
   *
   * Enquanto está na fila, o boletim enviado não é preço de ninguém: nem do
   * vizinho de praça, nem de quem enviou. É o que separa "o cliente ajuda a
   * alimentar a praça" de "o cliente mexe no preço que o concorrente vê".
   */
  it("o vizinho de praça não vê o envio na fila dele", async () => {
    const meu = await CotacoesEnvioService.getTela(cliente);
    const dele = await CotacoesEnvioService.getTela(vizinho);

    expect(meu.enviados.length).toBeGreaterThan(0);
    expect(dele.enviados).toEqual([]);
  });

  it("e não vê preço nenhum enquanto não for publicado", async () => {
    const painel = await CotacoesService.getPainel(vizinho);
    expect(painel.quoteDate).toBeNull();
    expect(painel.linhas).toEqual([]);
  });

  it("quem enviou também não vê preço ainda — a fila não publica", async () => {
    const painel = await CotacoesService.getPainel(cliente);
    expect(painel.quoteDate).toBeNull();
  });
});

describe("publicar", () => {
  it("o operador publica e AÍ o preço vale para a praça toda", async () => {
    const fila = await CotacoesEnvioService.listarFila();
    const meu = fila.find((f) => f.tenant.id === cliente);
    expect(meu, "o envio do cliente tem de estar na fila do operador").toBeDefined();

    const r = await CotacoesEnvioService.publicar({ id: meu!.id }, makeAdminCtx());
    expect(r.cotacoesGravadas).toBe(2);

    // O vizinho, que nunca enviou nada, passa a ver o preço: é o efeito
    // pretendido, e é exatamente por isso que publicar é ato do operador.
    const painel = await CotacoesService.getPainel(vizinho);
    expect(painel.quoteDate).not.toBeNull();
    expect(painel.linhas.length).toBe(2);
  });

  it("a procedência fica registrada como 'cliente', não como 'manual'", async () => {
    /*
      Quando o preço de uma praça for contestado, a primeira pergunta é "quem
      colocou isso aqui?". A diferença entre o operador ter colado e um cliente
      ter enviado é o que responde — e `sourceKey` é onde ela sobrevive.
    */
    const run = await prisma.ceasaImportRun.findFirst({
      where: { centralCode: MANUAL },
      orderBy: { startedAt: "desc" },
    });
    expect(run?.sourceKey).toBe("cliente");
  });

  it("publicar duas vezes é recusado", async () => {
    const publicado = await prisma.tenantBoletimEnviado.findFirstOrThrow({
      where: { tenantId: cliente, status: "PUBLICADO" },
    });
    await expect(
      CotacoesEnvioService.publicar({ id: publicado.id }, makeAdminCtx()),
    ).rejects.toThrow(/já foi revisado/i);
  });

  it("o cliente vê que o envio dele foi publicado", async () => {
    const tela = await CotacoesEnvioService.getTela(cliente);
    expect(tela.enviados.some((e) => e.status === "PUBLICADO")).toBe(true);
  });

  it("envio que não existe não publica nada", async () => {
    await expect(
      CotacoesEnvioService.publicar({ id: "naoexiste" }, makeAdminCtx()),
    ).rejects.toThrow(/não encontrado/i);
  });
});

describe("recusar", () => {
  it("recusa com motivo, e o motivo chega a quem enviou", async () => {
    const r = await CotacoesEnvioService.enviar(
      { quoteDate: new Date(DIA.getTime() - 24 * 60 * 60 * 1000), texto: BOLETIM },
      makeCtx(cliente),
    );
    await CotacoesEnvioService.recusar(
      { id: r.id, motivo: "As colunas de mínimo e máximo estão trocadas." },
      makeAdminCtx(),
    );

    const tela = await CotacoesEnvioService.getTela(cliente);
    const recusado = tela.enviados.find((e) => e.id === r.id);
    // Sem o motivo na tela, o cliente reenvia o mesmo erro e a fila cresce sem
    // ninguém entender por quê.
    expect(recusado?.status).toBe("RECUSADO");
    expect(recusado?.motivo).toMatch(/trocadas/);
  });

  it("recusado sai da fila do operador", async () => {
    const fila = await CotacoesEnvioService.listarFila();
    expect(fila.every((f) => f.tenant.id !== cliente || f.linhasValidas > 0)).toBe(true);
    const recusados = await prisma.tenantBoletimEnviado.findMany({
      where: { tenantId: cliente, status: "RECUSADO" },
      select: { id: true },
    });
    const idsNaFila = new Set(fila.map((f) => f.id));
    for (const rec of recusados) expect(idsNaFila.has(rec.id)).toBe(false);
  });
});

describe("apagar boletim publicado", () => {
  /**
   * O desfazer que faltava no módulo inteiro.
   *
   * `gravar` é primitiva de sobrescrita e toda leitura parte de
   * `MAX(quoteDate)`: um boletim errado numa praça manual era o preço oficial
   * dela até chegar um com data POSTERIOR — e numa praça manual isso não chega
   * sozinho. A única saída era SQL na produção.
   */
  it("apaga as cotações do dia e a execução que as gravou", async () => {
    const antes = await prisma.ceasaQuote.count({
      where: { centralCode: MANUAL, quoteDate: DIA },
    });
    expect(antes).toBeGreaterThan(0);

    const r = await CotacoesImportService.apagarBoletim(MANUAL, DIA);
    expect(r.cotacoesApagadas).toBe(antes);

    expect(
      await prisma.ceasaQuote.count({ where: { centralCode: MANUAL, quoteDate: DIA } }),
    ).toBe(0);
    // A execução sai junto: deixá-la faria `/admin/cotacoes` seguir afirmando
    // "importado com sucesso" para um dia que não tem mais preço nenhum.
    expect(
      await prisma.ceasaImportRun.count({ where: { centralCode: MANUAL, quoteDate: DIA } }),
    ).toBe(0);
  });

  it("NÃO apaga o catálogo de produtos, que é global e compartilhado", async () => {
    // Produto do boletim é compartilhado entre praças e datas: removê-lo por
    // causa de um boletim ruim derrubaria vínculos de outros clientes.
    const sobrou = await prisma.ceasaProduct.count({ where: { slug: { contains: "tomate" } } });
    expect(sobrou).toBeGreaterThan(0);
  });

  it("apagar dia sem boletim não é erro, é zero", async () => {
    const r = await CotacoesImportService.apagarBoletim(MANUAL, new Date(Date.UTC(2020, 0, 1)));
    expect(r.cotacoesApagadas).toBe(0);
  });
});
