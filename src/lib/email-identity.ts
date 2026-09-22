/**
 * Forma RAIZ de um e-mail: o mesmo endereço, sem os apelidos que o PRÓPRIO
 * provedor entrega na mesma caixa de entrada.
 *
 * Por que isto existe
 * -------------------
 * O teste grátis de 7 dias é concedido por endereço, e o endereço era comparado
 * como texto. Só que `dono@gmail.com`, `dono+1@gmail.com`, `dono+2@gmail.com` e
 * `d.o.n.o@gmail.com` são a MESMA caixa: o Gmail ignora os pontos do nome e tudo
 * que vem depois do `+`. Quem quisesse trial eterno não precisava de e-mail
 * descartável nenhum — bastava somar `+1` ao próprio endereço, receber o link de
 * confirmação na caixa de sempre e recomeçar os 7 dias. A confirmação de e-mail,
 * que é a única barreira de identidade que o cadastro tem (não pedimos cartão),
 * não filtrava nada nesse caminho.
 *
 * O que NÃO se tenta fazer aqui
 * -----------------------------
 * Adivinhar. A lista é fechada e só tem provedor cujo comportamento é público e
 * verificável. Normalizar por conta própria o domínio de terceiro é pior que não
 * normalizar: juntar dois endereços que na verdade são de duas pessoas recusa o
 * cadastro de um cliente legítimo — e ele não tem como saber o motivo, porque a
 * resposta do cadastro é genérica de propósito.
 *
 * Por isso o Yahoo fica de fora mesmo tendo apelidos: lá o separador é `-`, e
 * hífen é caractere comum em nome de pessoa (`joao-silva@yahoo.com`). O ganho
 * não paga o risco de confundir duas contas reais.
 *
 * O que fica guardado onde
 * ------------------------
 * `User.email` continua com o endereço COMO A PESSOA DIGITOU — é para ele que a
 * mensagem é entregue, e é ele que aparece na tela. `User.emailIdentity` guarda
 * o resultado desta função, e é só ele que responde "este e-mail já tem conta?".
 */

/** Domínios que são o mesmo serviço sob outro nome. */
const DOMINIOS_EQUIVALENTES: Record<string, string> = {
  "googlemail.com": "gmail.com",
};

/**
 * Provedores que ignoram os PONTOS do nome de usuário.
 * Hoje só o Gmail — e é o caso que sustenta a fraude na prática, porque é o
 * provedor da maioria dos cadastros.
 */
const IGNORAM_PONTOS = new Set(["gmail.com"]);

/**
 * Provedores que entregam `nome+qualquercoisa@` na caixa de `nome@`.
 * Verificado na documentação pública de cada um.
 */
const IGNORAM_SUFIXO_MAIS = new Set([
  "gmail.com",
  "outlook.com",
  "outlook.com.br",
  "hotmail.com",
  "hotmail.com.br",
  "live.com",
  "live.com.br",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "fastmail.com",
  "zoho.com",
]);

/**
 * Devolve a forma raiz do endereço, pronta para comparação.
 *
 * Entrada que não se pareça com um e-mail (sem `@`, ou com a parte local vazia
 * depois da limpeza) volta apenas em minúsculas e sem espaços: normalizar o que
 * não se entende seria inventar identidade.
 */
export function emailIdentity(email: string): string {
  const limpo = email.trim().toLowerCase();

  // `lastIndexOf`: a parte local pode conter `@` entre aspas. É raro, mas o
  // domínio é sempre o que vem depois do ÚLTIMO arroba.
  const arroba = limpo.lastIndexOf("@");
  if (arroba <= 0 || arroba === limpo.length - 1) return limpo;

  let local = limpo.slice(0, arroba);
  const dominio = DOMINIOS_EQUIVALENTES[limpo.slice(arroba + 1)] ?? limpo.slice(arroba + 1);

  // A ordem importa: o `+tag` sai primeiro, senão os pontos DENTRO da etiqueta
  // (`dono+nota.fiscal@gmail.com`) entrariam na conta do nome.
  if (IGNORAM_SUFIXO_MAIS.has(dominio)) {
    const mais = local.indexOf("+");
    if (mais >= 0) local = local.slice(0, mais);
  }
  if (IGNORAM_PONTOS.has(dominio)) {
    local = local.replaceAll(".", "");
  }

  // `+tag@gmail.com` ou `...@gmail.com` zeram a parte local. Endereço assim não
  // existe; devolver o original evita que várias entradas inválidas colidam numa
  // identidade só e bloqueiem cadastros legítimos.
  if (local.length === 0) return limpo;

  return `${local}@${dominio}`;
}

/** Os dois endereços chegam na mesma caixa de entrada? */
export function mesmaIdentidadeDeEmail(a: string, b: string): boolean {
  return emailIdentity(a) === emailIdentity(b);
}
