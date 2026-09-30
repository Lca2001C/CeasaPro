import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { AdminNotificationsService } from "@/lib/services/admin-notifications.service";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import { civilParts } from "@/lib/tz";
import type { FonteDeCotacao, ResultadoDaFonte } from "@/lib/cotacoes/fontes";

/**
 * Orquestração da importação automática.
 *
 * A fonte é INJETADA (não mockada por módulo): o teste fala com o código de
 * verdade e controla só a fronteira externa. `tests/setup/no-outbound-http.ts`
 * garante que nada aqui vá para a rede mesmo se alguém errar.
 *
 * O que estes testes protegem, em uma frase: **o alarme precisa ser confiável**.
 * Um aviso que dispara todo fim de semana é ignorado em um mês, e aí a quebra de
 * verdade passa batida junto com ele.
 */

const uniq = () => Math.random().toString(36).slice(2, 10);
const CENTRAL = `AUT${uniq().slice(0, 5)}`.toUpperCase();
const tenants: string[] = [];
/** Toda central criada por qualquer teste deste arquivo — limpa no afterAll. */
const centraisCriadas: string[] = [CENTRAL];
const slugs = ["tomate-do-robo", "batata-do-robo"];

/** Fonte falsa: devolve o que o teste mandar, sem tocar em rede. */
function fonteQueDevolve(...respostas: ResultadoDaFonte[]): FonteDeCotacao & { chamadas: number } {
  let i = 0;
  return {
    chave: "ceasaminas",
    chamadas: 0,
    async buscar() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).chamadas++;
      return respostas[Math.min(i++, respostas.length - 1)]!;
    },
    parse: () => ({ ok: false, linhas: [] }),
  };
}

const COM_DADOS: ResultadoDaFonte = {
  ok: true,
  vazio: false,
  linhas: [
    { produto: "TOMATE DO ROBO", unidade: "CX", minimo: 80, comum: 85, maximo: 90, referencia: 85 },
    { produto: "BATATA DO ROBO", unidade: "SC", minimo: 110, comum: 118, maximo: 125, referencia: 118 },
  ],
  fingerprint: "assinatura-a",
};
const SEM_BOLETIM: ResultadoDaFonte = { ok: true, vazio: true, linhas: [] };
const FALHOU: ResultadoDaFonte = { ok: false, linhas: [], erro: "HTTP 503" };

beforeAll(async () => {
  await prisma.ceasaCentral.create({
    data: {
      code: CENTRAL,
      name: "Central do Robo",
      city: "Contagem",
      uf: "MG",
      sourceKey: "ceasaminas",
      sourceParams: { mercado: "214" },
    },
  });
  const t = await createTestTenant(`Empresa Robo ${uniq()}`);
  tenants.push(t);
  await prisma.tenant.update({ where: { id: t }, data: { ceasaCentralCode: CENTRAL } });
});

beforeEach(async () => {
  await prisma.adminNotification.deleteMany({});
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: CENTRAL } });
});

afterAll(async () => {
  await prisma.adminNotification.deleteMany({});
  await cleanupTenants(tenants);
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: { in: centraisCriadas } } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: { in: centraisCriadas } } });
  await prisma.ceasaCentral.deleteMany({ where: { code: { in: centraisCriadas } } });
  await prisma.ceasaProduct.deleteMany({ where: { slug: { in: slugs } } });
});

describe("importarCentral", () => {
  it("grava o boletim e registra execução OK", async () => {
    const r = await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve(COM_DADOS),
    });
    expect(r.status).toBe("OK");
    expect(r.cotacoesGravadas).toBe(2);

    const run = await prisma.ceasaImportRun.findFirstOrThrow({ where: { centralCode: CENTRAL } });
    expect(run.status).toBe("OK");
    expect(run.fingerprint).toBe("assinatura-a");
  });

  it("reexecutar o mesmo dia é idempotente", async () => {
    const fonte = fonteQueDevolve(COM_DADOS);
    await CotacoesImportService.importarCentral(CENTRAL, { fonteInjetada: fonte });
    await CotacoesImportService.importarCentral(CENTRAL, { fonteInjetada: fonte });

    expect(await prisma.ceasaQuote.count({ where: { centralCode: CENTRAL } })).toBe(2);
  });

  /**
   * O par que sustenta a credibilidade do alarme: VAZIO cala, FALHA avisa.
   */
  it("dia sem boletim NÃO cria cotação NEM aviso", async () => {
    const r = await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve(SEM_BOLETIM),
    });
    expect(r.status).toBe("VAZIO");
    expect(await prisma.ceasaQuote.count({ where: { centralCode: CENTRAL } })).toBe(0);
    // Sábado, domingo e feriado caem aqui. Avisar seria treinar o operador a
    // ignorar o aviso.
    expect(await AdminNotificationsService.listar()).toHaveLength(0);
  });

  it("falha da fonte registra execução E avisa o super-admin", async () => {
    const r = await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve(FALHOU),
    });
    expect(r.status).toBe("FALHA");

    const run = await prisma.ceasaImportRun.findFirstOrThrow({ where: { centralCode: CENTRAL } });
    expect(run.status).toBe("FALHA");
    expect(run.error).toContain("503");

    const avisos = await AdminNotificationsService.listar();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.kind).toBe("COTACOES_FALHA");
    expect(avisos[0]!.href).toBe("/admin/cotacoes");
  });

  /**
   * Recuo de datas: feriado emendado não pode deixar a tela vazia havendo dado
   * de dois dias atrás. A tela mostra a data do que veio, então recuar é honesto.
   */
  it("recua no calendário quando o dia de hoje não tem boletim", async () => {
    const fonte = fonteQueDevolve(SEM_BOLETIM, SEM_BOLETIM, COM_DADOS);
    const r = await CotacoesImportService.importarCentral(CENTRAL, { fonteInjetada: fonte });

    expect(r.status).toBe("OK");
    expect(fonte.chamadas).toBe(3);

    // A cotação ficou gravada com a data do dia que realmente tinha boletim —
    // contada no dia BRASILEIRO, não no do servidor. Este cálculo precisa usar
    // `civilParts` pelo mesmo motivo que o serviço usa: entre 21h e meia-noite
    // no Brasil, o "hoje" em UTC já é amanhã, e a conta daria um dia a mais.
    const q = await prisma.ceasaQuote.findFirstOrThrow({ where: { centralCode: CENTRAL } });
    const hoje = civilParts(new Date());
    const doisDiasAtras = new Date(Date.UTC(hoje.year, hoje.month - 1, hoje.day - 2));
    expect(q.quoteDate.toISOString().slice(0, 10)).toBe(
      doisDiasAtras.toISOString().slice(0, 10),
    );
  });

  /**
   * Sete dias, não três.
   *
   * Medido contra a fonte real: Juiz de Fora, Barbacena, Caratinga e Poços de
   * Caldas publicam 2 a 3 vezes por semana, com intervalos de até 4 dias. Com
   * recuo de 3, a importação dessas unidades voltaria vazia na maior parte dos
   * dias mesmo havendo boletim recente, e a tela do cliente ficaria sem preço
   * sem que nada estivesse quebrado.
   */
  it("recua até uma semana, e então desiste sem alarmar", async () => {
    const fonte = fonteQueDevolve(SEM_BOLETIM);
    const r = await CotacoesImportService.importarCentral(CENTRAL, { fonteInjetada: fonte });
    expect(r.status).toBe("VAZIO");
    // Uma semana cobre qualquer cadência semanal — e não fica tentando o ano
    // inteiro contra um servidor de terceiro.
    expect(fonte.chamadas).toBe(7);
    expect(await AdminNotificationsService.listar()).toHaveLength(0);
  });

  /**
   * A camada que nenhuma outra cobre: o parsing "funciona", o cron fica verde, e
   * mesmo assim a estrutura mudou — colunas trocadas fazem o preço errado
   * aparecer como certo.
   */
  it("mudança de estrutura avisa MESMO com a importação dando certo", async () => {
    await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve(COM_DADOS),
    });
    await prisma.adminNotification.deleteMany({});

    const r = await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve({ ...COM_DADOS, fingerprint: "assinatura-B-diferente" }),
    });

    expect(r.status).toBe("OK"); // a importação NÃO falhou
    const avisos = await AdminNotificationsService.listar();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.title).toMatch(/formato/i);
  });

  it("estrutura igual à anterior não gera ruído", async () => {
    await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve(COM_DADOS),
    });
    await prisma.adminNotification.deleteMany({});
    await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve(COM_DADOS),
    });
    expect(await AdminNotificationsService.listar()).toHaveLength(0);
  });

  it("central alimentada à mão é PULADA, não tratada como falha", async () => {
    // Se `manual` fosse tratada como fonte quebrada, o super-admin receberia
    // alarme todo dia por uma central que funciona.
    const manual = `MAN${uniq().slice(0, 5)}`.toUpperCase();
    centraisCriadas.push(manual);
    await prisma.ceasaCentral.create({
      data: {
        code: manual,
        name: "Central Manual",
        city: "X",
        uf: "MG",
        sourceKey: "manual",
      },
    });
    const r = await CotacoesImportService.importarCentral(manual);
    expect(r.status).toBe("SEM_FONTE");
    expect(await AdminNotificationsService.listar()).toHaveLength(0);
  });
});

describe("importarTodasAsCentrais", () => {
  /**
   * Central MANUAL não entra na fila — e isto é sobre o orçamento de tempo.
   *
   * A fila é ordenada por quem está mais atrasado, para nenhuma central passar
   * fome. Só que central manual NUNCA recebe boletim automático: ela é
   * eternamente a mais atrasada e vai sempre para a frente da fila. Com a pausa
   * de 2 s entre centrais, bastam ~20 clientes em praças manuais para o
   * orçamento acabar antes de a primeira central AUTOMÁTICA ser tocada — e o
   * cliente que paga e tem fonte de verdade fica sem boletim, todo dia, sem
   * nenhum erro aparecer.
   */
  it("central MANUAL não entra na fila e não gasta o orçamento", async () => {
    const manual = `FIL${uniq().slice(0, 5)}`.toUpperCase();

    // Registrado ANTES de criar: a limpeza mora no `afterAll`, porque limpeza no
    // corpo do teste não roda quando a asserção falha — e um teste vermelho
    // deixaria central órfã no banco. Aconteceu de verdade ao provar este
    // defeito com a correção desfeita.
    centraisCriadas.push(manual);
    await prisma.ceasaCentral.create({
      data: {
        code: manual,
        name: "Central Manual Na Fila",
        city: "X",
        uf: "MG",
        sourceKey: "manual",
        // Sem boletim nenhum: sob a ordenação por atraso, iria para a frente.
        sortOrder: 0,
      },
    });
    const cliente = await createTestTenant(`Empresa Manual ${uniq()}`);
    tenants.push(cliente);
    await prisma.tenant.update({
      where: { id: cliente },
      data: { ceasaCentralCode: manual },
    });

    const r = await CotacoesImportService.importarTodasAsCentrais({
      fonteInjetada: fonteQueDevolve(COM_DADOS),
    });

    const tocadas = r.resultados.map((x) => x.centralCode);
    expect(tocadas).not.toContain(manual);
    // A automática continua sendo importada.
    expect(tocadas).toContain(CENTRAL);

  });

  it("importa só as centrais que algum cliente usa", async () => {
    const semCliente = `ORF${uniq().slice(0, 5)}`.toUpperCase();
    centraisCriadas.push(semCliente);
    await prisma.ceasaCentral.create({
      data: {
        code: semCliente,
        name: "Central Orfa",
        city: "X",
        uf: "MG",
        sourceKey: "ceasaminas",
        sourceParams: { mercado: "999" },
      },
    });

    const r = await CotacoesImportService.importarTodasAsCentrais({
      fonteInjetada: fonteQueDevolve(COM_DADOS),
    });

    // Não se martela um site público por dado que ninguém lê.
    expect(r.resultados.map((x) => x.centralCode)).toContain(CENTRAL);
    expect(r.resultados.map((x) => x.centralCode)).not.toContain(semCliente);
  });
});

describe("verificarDefasagem", () => {
  it("cala quando o boletim é de ontem", async () => {
    await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve(COM_DADOS),
    });
    await prisma.adminNotification.deleteMany({});

    expect(await CotacoesImportService.verificarDefasagem()).toEqual([]);
    expect(await AdminNotificationsService.listar()).toHaveLength(0);
  });

  /**
   * O único alarme que um defeito nos outros dois não desarma: ele olha só o
   * resultado — há boletim recente ou não? — e não depende de o código de
   * detecção de falha ter chegado a rodar.
   */
  it("avisa quando a central tem clientes e está sem boletim novo", async () => {
    await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve(COM_DADOS),
    });
    await prisma.adminNotification.deleteMany({});

    // Dez dias no futuro: o boletim gravado hoje vira "velho".
    const daquiDezDias = new Date(Date.now() + 10 * 86_400_000);
    const defasadas = await CotacoesImportService.verificarDefasagem(daquiDezDias);

    expect(defasadas.map((d) => d.code)).toContain(CENTRAL);
    const avisos = await AdminNotificationsService.listar();
    expect(avisos[0]!.kind).toBe("COTACOES_DESATUALIZADAS");
    expect(avisos[0]!.body).toMatch(/sem boletim novo/i);
  });

  it("central SEM clientes não gera alarme, mesmo sem boletim nenhum", async () => {
    // Central no catálogo que ninguém escolheu estar vazia é o esperado, não um
    // problema. Alarmar aqui encheria a caixa de ruído permanente.
    const orfa = `VAZ${uniq().slice(0, 5)}`.toUpperCase();
    centraisCriadas.push(orfa);
    await prisma.ceasaCentral.create({
      data: { code: orfa, name: "Central Sem Cliente", city: "X", uf: "MG", sourceKey: "ceasaminas" },
    });
    const defasadas = await CotacoesImportService.verificarDefasagem();
    expect(defasadas.map((d) => d.code)).not.toContain(orfa);
  });
});

describe("prazo da execução (#49)", () => {
  /**
   * Uma fonte pendurada não pode decidir quanto tempo a função vive.
   *
   * Antes, o orçamento só era conferido na PARTIDA de cada central: uma central
   * começada com folga "suficiente" levava 12 + 1 + 12 s por requisição e
   * passava do `maxDuration` — a plataforma matava a função, a run não era
   * gravada e `verificarDefasagem` (que roda depois) não rodava.
   *
   * A fonte falsa aqui se comporta como `buscarHtml` com prazo: fica pendurada
   * até o prazo que recebeu e devolve `semTempo`. O que se prova é que o prazo
   * CHEGA à fonte, que a importação inteira termina dentro do orçamento, e que o
   * desfecho é registrado sem alarme de falha.
   */
  it("central pendurada é interrompida dentro do orçamento, registrada e sem aviso de falha", async () => {
    const prazosRecebidos: (number | undefined)[] = [];
    const pendurada: FonteDeCotacao = {
      chave: "ceasaminas",
      async buscar({ prazo }) {
        prazosRecebidos.push(prazo);
        await new Promise((r) => setTimeout(r, Math.max(0, (prazo ?? Date.now()) - Date.now())));
        return { ok: false, linhas: [], erro: "prazo da execução esgotado", semTempo: true };
      },
      parse: () => ({ ok: false, linhas: [] }),
    };

    const orcamentoMs = 7_000;
    const inicio = Date.now();
    const r = await CotacoesImportService.importarTodasAsCentrais({
      fonteInjetada: pendurada,
      orcamentoMs,
    });
    const decorrido = Date.now() - inicio;

    expect(decorrido).toBeLessThan(orcamentoMs);
    expect(prazosRecebidos.length).toBeGreaterThan(0);
    for (const p of prazosRecebidos) {
      expect(p).toBeDefined();
      expect(p!).toBeLessThanOrEqual(inicio + orcamentoMs);
    }
    // Quem começou foi interrompido; quem não coube ficou para a próxima.
    expect(r.resultados.every((x) => x.status === "SEM_TEMPO")).toBe(true);
    expect(r.resultados.length + r.puladasPorTempo).toBe(r.centrais);

    const tocada = r.resultados[0]!.centralCode;
    const run = await prisma.ceasaImportRun.findFirstOrThrow({
      where: { centralCode: tocada },
      orderBy: { startedAt: "desc" },
    });
    expect(run.status).toBe("FALHA");
    expect(run.error).toMatch(/Interrompida/);
    // "Não deu tempo" não é a fonte quebrada: nada de COTACOES_FALHA.
    expect(await AdminNotificationsService.listar()).toHaveLength(0);

    // Limpa as runs que a interrupção gravou em centrais de OUTROS testes/seed.
    await prisma.ceasaImportRun.deleteMany({
      where: { error: { startsWith: "Interrompida" }, startedAt: { gte: new Date(inicio) } },
    });
  }, 15_000);

  it("prazo já vencido: nenhum dia é pedido à fonte", async () => {
    const fonte = fonteQueDevolve(COM_DADOS);
    const r = await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonte,
      prazo: Date.now() - 1,
    });
    expect(r.status).toBe("SEM_TEMPO");
    expect(fonte.chamadas).toBe(0);
  });
});

describe("lacunas entre boletins (#53)", () => {
  /**
   * Praça que publica DEPOIS do cron: o boletim de terça sai às 15h, e na
   * quarta às 13:30 o de quarta já saiu. O recuo achava quarta e parava — a
   * terça nunca era pedida, e o histórico pulava um pregão calado.
   */
  const hoje = civilParts(new Date());
  const diaMenos = (n: number) => new Date(Date.UTC(hoje.year, hoje.month - 1, hoje.day - n));
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  /** Fonte que responde conforme a DATA pedida, e anota as datas. */
  function fontePorData(comBoletim: Set<string>) {
    const pedidas: string[] = [];
    const fonte: FonteDeCotacao = {
      chave: "ceasaminas",
      async buscar({ data }) {
        pedidas.push(iso(data));
        return comBoletim.has(iso(data)) ? COM_DADOS : SEM_BOLETIM;
      },
      parse: () => ({ ok: false, linhas: [] }),
    };
    return { fonte, pedidas };
  }

  it("completa o dia que faltou entre o último gravado e o de hoje", async () => {
    // Já gravado: três dias atrás.
    await CotacoesImportService.gravar({
      centralCode: CENTRAL,
      quoteDate: diaMenos(3),
      linhas: COM_DADOS.linhas,
      sourceKey: "ceasaminas",
    });
    const { fonte, pedidas } = fontePorData(new Set([iso(diaMenos(0)), iso(diaMenos(1))]));

    const r = await CotacoesImportService.importarCentral(CENTRAL, { fonteInjetada: fonte });

    expect(r.status).toBe("OK");
    expect(r.diasCompletados).toBe(1);
    const dias = await prisma.ceasaQuote.findMany({
      where: { centralCode: CENTRAL },
      select: { quoteDate: true },
      distinct: ["quoteDate"],
      orderBy: { quoteDate: "asc" },
    });
    expect(dias.map((d) => iso(d.quoteDate))).toEqual([
      iso(diaMenos(3)),
      iso(diaMenos(1)),
      iso(diaMenos(0)),
    ]);
    // Parou no último gravado: não pediu de novo o dia -3 nem além dele.
    expect(pedidas).toEqual([iso(diaMenos(0)), iso(diaMenos(1)), iso(diaMenos(2))]);
  });

  it("praça diária já em dia: nenhuma requisição a mais", async () => {
    await CotacoesImportService.gravar({
      centralCode: CENTRAL,
      quoteDate: diaMenos(1),
      linhas: COM_DADOS.linhas,
      sourceKey: "ceasaminas",
    });
    const { fonte, pedidas } = fontePorData(new Set([iso(diaMenos(0))]));
    const r = await CotacoesImportService.importarCentral(CENTRAL, { fonteInjetada: fonte });
    expect(r.diasCompletados).toBe(0);
    expect(pedidas).toEqual([iso(diaMenos(0))]);
  });

  it("falha ao completar não derruba o dia principal", async () => {
    await CotacoesImportService.gravar({
      centralCode: CENTRAL,
      quoteDate: diaMenos(4),
      linhas: COM_DADOS.linhas,
      sourceKey: "ceasaminas",
    });
    const r = await CotacoesImportService.importarCentral(CENTRAL, {
      fonteInjetada: fonteQueDevolve(COM_DADOS, FALHOU),
    });
    expect(r.status).toBe("OK");
    expect(r.diasCompletados).toBe(0);
    // Tarefa acessória: não vira aviso de falha da central.
    expect(await AdminNotificationsService.listar()).toHaveLength(0);
  });
});
