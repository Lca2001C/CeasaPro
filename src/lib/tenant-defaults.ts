/**
 * Valores de partida do cadastro mínimo.
 *
 * O cadastro público passou a pedir só e-mail e senha, mas `Tenant.tradeName` e
 * `User.name` são NOT NULL: alguém tem de escolher o que vai na coluna. Este
 * arquivo é esse alguém, e num lugar só — porque o valor escolhido para
 * `tradeName` é TAMBÉM o sinal de "ainda não preencheu", lido pelo cartão do
 * Início e pelo aviso da assinatura. Espalhar o literal faria a detecção
 * divergir do que foi gravado, e o aviso ficaria presente para sempre (ou nunca
 * apareceria) sem que ninguém entendesse por quê.
 *
 * Sem imports, de propósito: isto é lido por Server Component e por componente
 * de cliente. Um import de `@/lib/db` ou de `@prisma/client` aqui arrastaria o
 * Prisma para o bundle do navegador — o mesmo motivo que mantém
 * `src/lib/venda/total.ts` sem dependências.
 */

/**
 * Nome exibido enquanto a empresa não tem nome.
 *
 * NÃO é texto novo: é exatamente o fallback que `(app)/layout.tsx` já mostrava
 * quando a leitura do tenant falhava. Reaproveitá-lo mantém a tela com a mesma
 * cara que já tinha nesse caso e dá o detector de graça, sem coluna nova.
 */
export const NOME_EMPRESA_PADRAO = "Minha empresa";

/** Teto de `Tenant.tradeName` e `User.name` no schema. */
const MAX_NOME = 120;

/**
 * Nome inicial da PESSOA, derivado do e-mail.
 *
 * `User.name` é quem usa o sistema, não a empresa — ele vai para o `payerName`
 * do Mercado Pago e para a segunda linha do cabeçalho. Carimbar
 * `NOME_EMPRESA_PADRAO` aqui produziria "Olá, Minha empresa" na cobrança.
 *
 * A parte local do e-mail é o único identificador pessoal que o cadastro mínimo
 * conhece. É um palpite — e é por isso que a pessoa pode corrigi-lo em
 * Configurações → Meu perfil, que passa a existir junto com esta mudança.
 */
export function nomeInicialPeloEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const nome = local
    .split(/[._+-]+/)
    .map((parte) => parte.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase())
    .join(" ")
    .slice(0, MAX_NOME)
    .trim();
  // `User.name` é NOT NULL: "123456@x.com" ainda dá "123456", mas um endereço
  // sem parte local aproveitável não pode virar string vazia e quebrar o insert.
  return nome || "Usuário";
}

/**
 * A empresa ainda está com o nome de partida?
 *
 * Ponto único de comparação: quem grava e quem detecta usam a mesma constante.
 */
export function empresaSemNome(tradeName: string | null | undefined): boolean {
  const nome = (tradeName ?? "").trim();
  return nome === "" || nome === NOME_EMPRESA_PADRAO;
}

export interface DadosParaChecagemDeCadastro {
  tradeName: string | null;
  phone: string | null;
}

/**
 * O que ainda falta no cadastro, já em texto de tela.
 *
 * Devolve LISTA e não booleano porque o cartão do Início mostra o que falta:
 * "complete seu cadastro", sem dizer o quê, é o tipo de aviso que a pessoa
 * dispensa sem entender — e aí ele só atrapalhou.
 */
export function cadastroIncompleto(t: DadosParaChecagemDeCadastro): string[] {
  const faltando: string[] = [];
  if (empresaSemNome(t.tradeName)) faltando.push("o nome da sua empresa");
  if (!t.phone?.trim()) faltando.push("um telefone com WhatsApp para contato");
  return faltando;
}
