import { describe, it, expect, afterAll, vi } from "vitest";

/**
 * O trial de 7 dias é concedido por endereço — e o endereço precisa identificar
 * uma CAIXA DE ENTRADA, não um texto.
 *
 * Enquanto `emailEmUso` comparava string, `dono+1@gmail.com`, `dono+2@gmail.com`
 * e `d.o.n.o@gmail.com` passavam como endereços novos: cada um criava empresa,
 * recebia o link de confirmação na MESMA caixa e ganhava mais 7 dias. Não era
 * preciso nem e-mail descartável, e a confirmação de e-mail — a única barreira de
 * identidade que o cadastro tem, porque não pedimos cartão — não filtrava nada.
 *
 * A resposta visível continua idêntica nos dois casos (o cadastro nunca revela se
 * um e-mail já tem conta); o que muda é o que acontece no banco.
 */

const correio = vi.hoisted(() => ({ enviados: [] as { para: string; html: string }[] }));

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendEmail: vi.fn(async (para: string, _assunto: string, html: string) => {
      correio.enviados.push({ para, html });
      return { ok: true as const };
    }),
  };
});

import { prisma } from "@/lib/db/prisma";
import { SignupService } from "@/lib/services/signup.service";
import { emailIdentity } from "@/lib/email-identity";
import { emailEmUso } from "@/lib/services/tenant-provisioning";
import { cleanupTenants } from "../helpers/factory";
import type { SignupInput } from "@/lib/validations/auth";

const uniq = () => `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
const tenants: string[] = [];
const emails: string[] = [];
let planoId = "";

async function planoDeEntrada() {
  if (planoId) return planoId;
  const plano = await prisma.plan.create({
    data: {
      name: "Plano Alias",
      slug: `alias-${uniq()}`,
      // Um centavo: a regra é "entra no ATIVO mais barato", e um plano caro
      // deixaria o teste refém de planos de outros arquivos que tenham sobrado
      // na base quando uma suíte quebrou no meio.
      priceMonthly: 0.01,
      active: true,
      features: { modules: [] },
    },
  });
  planoId = plano.id;
  return planoId;
}

async function registrar(email: string) {
  await planoDeEntrada();
  emails.push(email);
  const input: SignupInput = { email, password: "senha1234" };
  const res = await SignupService.register(input, { ip: "203.0.113.20" });
  if (res.tenantId) tenants.push(res.tenantId);
  return res;
}

afterAll(async () => {
  await cleanupTenants(tenants);
  // Sobra a linha de usuário carimbada de empresa excluída, se houver.
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  if (planoId) await prisma.plan.delete({ where: { id: planoId } }).catch(() => {});
});

describe("Apelidos do provedor não rendem um segundo teste grátis", () => {
  it("+etiqueta no Gmail cai no cadastro já existente", async () => {
    const base = `alias-${uniq()}@gmail.com`;
    const primeiro = await registrar(base);
    expect(primeiro.outcome).toBe("created");

    const [nome, dominio] = base.split("@");
    const segundo = await registrar(`${nome}+teste@${dominio}`);

    expect(segundo.outcome).toBe("email_already_in_use");
    expect(segundo.tenantId).toBeUndefined();
  });

  it("pontos no nome do Gmail também", async () => {
    const nome = `alias${uniq()}`;
    const primeiro = await registrar(`${nome}@gmail.com`);
    expect(primeiro.outcome).toBe("created");

    // `a.b.c@gmail.com` chega na caixa de `abc@gmail.com`.
    const comPontos = nome.split("").join(".");
    const segundo = await registrar(`${comPontos}@gmail.com`);
    expect(segundo.outcome).toBe("email_already_in_use");
  });

  it("googlemail.com é a mesma conta do gmail.com", async () => {
    const nome = `alias${uniq()}`;
    await registrar(`${nome}@gmail.com`);
    const segundo = await registrar(`${nome}+nf@googlemail.com`);
    expect(segundo.outcome).toBe("email_already_in_use");
  });

  it("+etiqueta no Outlook também é a mesma caixa", async () => {
    const nome = `alias${uniq()}`;
    await registrar(`${nome}@outlook.com`);
    const segundo = await registrar(`${nome}+segundo@outlook.com`);
    expect(segundo.outcome).toBe("email_already_in_use");
  });

  it("três variações criam UMA empresa, e um só trial", async () => {
    // O ponto econômico do caso: o que se estava dando de graça era 7 dias por
    // variação, sem teto.
    const nome = `alias${uniq()}`;
    const variacoes = [
      `${nome}@gmail.com`,
      `${nome}+1@gmail.com`,
      `${nome.split("").join(".")}@gmail.com`,
    ];
    for (const v of variacoes) await registrar(v);

    const identidade = emailIdentity(variacoes[0]!);
    const contas = await prisma.user.count({
      where: { emailIdentity: identidade, deletedAt: null },
    });
    expect(contas).toBe(1);
  });
});

describe("O que continua passando (senão a trava vira prejuízo)", () => {
  it("domínio próprio com + é endereço legítimo e cria conta", async () => {
    // Um servidor corporativo pode tratar `+` como caractere comum. Normalizar
    // ali juntaria duas pessoas diferentes e recusaria um cliente de verdade —
    // com a resposta genérica, que não explica nada.
    const base = `compras${uniq()}`;
    await registrar(`${base}@empresa-teste-ceasapro.com.br`);
    const outro = await registrar(`${base}+hortifruti@empresa-teste-ceasapro.com.br`);
    expect(outro.outcome).toBe("created");
  });

  it("contas diferentes no mesmo provedor continuam diferentes", async () => {
    const nome = `alias${uniq()}`;
    await registrar(`${nome}@gmail.com`);
    const outro = await registrar(`${nome}x@gmail.com`);
    expect(outro.outcome).toBe("created");
  });

  it("a conta criada guarda o e-mail DIGITADO e a identidade raiz", async () => {
    // `email` é para onde a mensagem vai e o que a pessoa vê na tela; a
    // identidade é só a chave de deduplicação.
    const nome = `alias${uniq()}`;
    const digitado = `${nome}+nota.fiscal@gmail.com`;
    const res = await registrar(digitado);
    expect(res.outcome).toBe("created");

    const user = await prisma.user.findFirstOrThrow({ where: { id: res.userId } });
    expect(user.email).toBe(digitado);
    expect(user.emailIdentity).toBe(`${nome}@gmail.com`);
  });
});

describe("emailEmUso responde pela identidade", () => {
  it("reconhece a variação de uma conta viva", async () => {
    const nome = `alias${uniq()}`;
    await registrar(`${nome}@gmail.com`);
    expect(await emailEmUso(`${nome}+x@gmail.com`)).toBe(true);
    expect(await emailEmUso(`${nome}outro@gmail.com`)).toBe(false);
  });

  it("conta EXCLUÍDA libera o endereço e as variações dele", async () => {
    const nome = `alias${uniq()}`;
    const res = await registrar(`${nome}@gmail.com`);
    await prisma.user.update({
      where: { id: res.userId },
      data: { deletedAt: new Date(), emailIdentity: null },
    });

    expect(await emailEmUso(`${nome}@gmail.com`)).toBe(false);
    expect(await emailEmUso(`${nome}+x@gmail.com`)).toBe(false);
  });
});
