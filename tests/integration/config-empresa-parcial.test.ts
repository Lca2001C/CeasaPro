import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ConfigService } from "@/lib/services/config.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * `updateCompany` apagava tudo que não recebia.
 *
 * O código escrevia `input.X ?? null` para cada campo opcional, e em JavaScript
 * `undefined ?? null` é `null` — então "não mandei este campo" e "quero limpar
 * este campo" eram a MESMA coisa para o banco. Quem salvasse por um formulário
 * que não conhece todos os campos perdia os outros silenciosamente.
 *
 * Não era hipotético: o wizard do onboarding mandava `legalName: null`,
 * `cnpj: null` e `businessHours: null` fixos (`wizard.tsx:39-46`), então quem
 * preenchia razão social e CNPJ em Configurações e depois voltava ao wizard via
 * "primeiros passos" perdia os dois sem nenhum aviso.
 *
 * O teste vale ainda mais agora: acrescentar `establishmentType` ao schema SEM
 * corrigir isto faria o campo novo entrar na mesma armadilha no dia 1.
 */
describe("ConfigService.updateCompany — atualização parcial", () => {
  const tenants: string[] = [];
  // `Tenant.cnpj` é @unique: cada empresa do teste precisa do seu.
  let seq = 0;

  async function empresaCompleta() {
    const cnpj = `12.345.678/000${++seq}-90`;
    const id = await createTestTenant("Hortifruti Teste Parcial");
    tenants.push(id);
    await prisma.tenant.update({
      where: { id },
      data: {
        legalName: "Hortifruti Teste LTDA",
        cnpj,
        phone: "31999990000",
        address: "Box 42, Pavilhao 3",
        businessHours: "Seg a Sab, 4h as 12h",
        establishmentType: "Box de hortifruti",
      },
    });
    return { id, cnpj };
  }

  afterAll(async () => {
    await cleanupTenants(tenants);
  });

  it("campo NAO enviado é preservado, não zerado", async () => {
    const { id, cnpj: cnpjDaVez } = await empresaCompleta();

    // Exatamente o que o wizard manda: nome, telefone e endereço. As outras
    // chaves nem existem no objeto.
    await ConfigService.updateCompany(
      { tradeName: "Hortifruti Silva", phone: "31988887777", address: "Box 7" },
      makeCtx(id),
    );

    const t = await prisma.tenant.findUniqueOrThrow({ where: { id } });
    expect(t.tradeName).toBe("Hortifruti Silva");
    expect(t.phone).toBe("31988887777");
    expect(t.address).toBe("Box 7");
    // O que o código anterior apagava:
    expect(t.legalName).toBe("Hortifruti Teste LTDA");
    expect(t.cnpj).toBe(cnpjDaVez);
    expect(t.businessHours).toBe("Seg a Sab, 4h as 12h");
    expect(t.establishmentType).toBe("Box de hortifruti");
  });

  it("null EXPLÍCITO continua limpando — 'não enviei' e 'apague' são coisas diferentes", async () => {
    const { id } = await empresaCompleta();

    await ConfigService.updateCompany(
      { tradeName: "Hortifruti Silva", cnpj: null, businessHours: null },
      makeCtx(id),
    );

    const t = await prisma.tenant.findUniqueOrThrow({ where: { id } });
    expect(t.cnpj).toBeNull();
    expect(t.businessHours).toBeNull();
    // Não enviados: intactos.
    expect(t.legalName).toBe("Hortifruti Teste LTDA");
    expect(t.phone).toBe("31999990000");
  });

  it("string vazia do formulário também limpa (o input devolve '', não null)", async () => {
    const { id } = await empresaCompleta();

    await ConfigService.updateCompany(
      { tradeName: "Hortifruti Silva", legalName: "", cnpj: "" },
      makeCtx(id),
    );

    const t = await prisma.tenant.findUniqueOrThrow({ where: { id } });
    expect(t.legalName).toBeNull();
    expect(t.cnpj).toBeNull();
  });
});
