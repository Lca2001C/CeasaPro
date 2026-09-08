import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { cadastroIncompleto } from "@/lib/tenant-defaults";
import type { EmpresaInput, PerfilInput } from "@/lib/validations/config";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * `<input>` devolve "" quando a pessoa apaga o campo. Guardar "" em umas linhas
 * e `null` em outras obrigaria toda leitura a checar as duas coisas, então o
 * vazio é normalizado para `null` na entrada.
 */
function nuloSeVazio(v: string | null): string | null {
  const limpo = (v ?? "").trim();
  return limpo === "" ? null : limpo;
}

export const ConfigService = {
  async getCompany(tenantId: string) {
    return prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: { include: { plan: true } } },
    });
  },

  /**
   * Atualização PARCIAL: chave ausente não é escrita.
   *
   * Antes o método montava `input.X ?? null` para cada campo opcional, e em
   * JavaScript `undefined ?? null` é `null` — então "não mandei este campo" e
   * "quero limpar este campo" chegavam idênticos ao banco, e quem salvasse por
   * um formulário que não conhece todos os campos apagava o resto sem aviso.
   * O wizard do onboarding fazia exatamente isso com razão social, CNPJ e
   * horário de funcionamento.
   *
   * A distinção que o spread condicional preserva:
   *   - chave AUSENTE (`undefined`) → fica fora do UPDATE, o banco mantém o que tinha;
   *   - `null` ou `""`              → vai como `null`, a pessoa limpou de propósito.
   *
   * Isto precisa continuar valendo para todo campo opcional que for acrescentado
   * aqui: `establishmentType` entrou junto com o cadastro simplificado e cairia
   * na mesma armadilha no dia 1.
   */
  async updateCompany(input: EmpresaInput, ctx: TenantCtx) {
    const t = await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        // Obrigatório no schema: sempre presente, sempre escrito.
        tradeName: input.tradeName,
        ...(input.legalName !== undefined && { legalName: nuloSeVazio(input.legalName) }),
        ...(input.cnpj !== undefined && { cnpj: nuloSeVazio(input.cnpj) }),
        ...(input.phone !== undefined && { phone: nuloSeVazio(input.phone) }),
        ...(input.address !== undefined && { address: nuloSeVazio(input.address) }),
        ...(input.businessHours !== undefined && {
          businessHours: nuloSeVazio(input.businessHours),
        }),
        ...(input.uf !== undefined && { uf: nuloSeVazio(input.uf) }),
        ...(input.establishmentType !== undefined && {
          establishmentType: nuloSeVazio(input.establishmentType),
        }),
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Tenant",
      entityId: ctx.tenantId,
      newData: { tradeName: t.tradeName },
      ip: ctx.ip,
    });
    return t;
  },

  /**
   * Nome de quem usa o sistema.
   *
   * Fica separado de `updateCompany` porque escreve em `User`, não em `Tenant`:
   * o escopo vem de `ctx.userId` (que sai da sessão), e por isso usa o `prisma`
   * cru — `User` é modelo de plataforma, sem `tenantId` na extensão de tenant.
   *
   * Até aqui `User.name` não era editável em lugar nenhum do sistema, e ele é o
   * `payerName` que vai para o Mercado Pago. Com o cadastro mínimo derivando o
   * nome do e-mail, deixar sem edição seria um palpite sem saída.
   */
  async updateProfile(input: PerfilInput, ctx: TenantCtx) {
    const u = await prisma.user.update({
      where: { id: ctx.userId },
      data: { name: input.name },
      select: { id: true, name: true, email: true },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "User",
      entityId: u.id,
      newData: { name: u.name },
      ip: ctx.ip,
    });
    return u;
  },

  /**
   * O que o cartão do Início precisa saber.
   *
   * `onboardingCompletedAt` deixou de ser "passou pelo wizard obrigatório" e
   * passou a ser "o convite de primeiros passos já foi resolvido" — concluído ou
   * dispensado. Reaproveitar a coluna dá dispensa persistente entre aparelhos
   * sem migration, e é o mesmo flag que antes governava o redirecionamento.
   */
  async pendenciasDoCadastro(tenantId: string) {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { tradeName: true, phone: true, onboardingCompletedAt: true },
    });
    return {
      mostrar: Boolean(t) && t!.onboardingCompletedAt === null,
      faltando: t ? cadastroIncompleto(t) : [],
    };
  },

  async completeOnboarding(ctx: TenantCtx) {
    await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { onboardingCompletedAt: new Date() },
    });
  },
};
