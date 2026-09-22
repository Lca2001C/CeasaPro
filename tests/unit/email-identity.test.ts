import { describe, it, expect } from "vitest";
import { emailIdentity, mesmaIdentidadeDeEmail } from "@/lib/email-identity";

/**
 * A forma raiz do e-mail é o que separa "endereço novo" de "mesma caixa com
 * outro nome" — e é sobre isso que o trial de 7 dias é concedido.
 *
 * O teste tem dois lados, e o segundo é o que protege receita legítima: juntar
 * de menos devolve o trial infinito; juntar DEMAIS recusa o cadastro de um
 * cliente de verdade, com uma resposta genérica que não explica nada (o cadastro
 * nunca revela que o e-mail já existe). Por isso metade dos casos aqui afirma o
 * que NÃO pode ser normalizado.
 */

describe("Gmail: pontos e +etiqueta são a mesma caixa", () => {
  it("remove a etiqueta depois do +", () => {
    expect(emailIdentity("dono+teste@gmail.com")).toBe("dono@gmail.com");
    expect(emailIdentity("dono+1@gmail.com")).toBe("dono@gmail.com");
  });

  it("remove os pontos do nome de usuário", () => {
    expect(emailIdentity("d.o.n.o@gmail.com")).toBe("dono@gmail.com");
  });

  it("googlemail.com é o mesmo serviço", () => {
    expect(emailIdentity("dono@googlemail.com")).toBe("dono@gmail.com");
    expect(emailIdentity("do.no+nf@googlemail.com")).toBe("dono@gmail.com");
  });

  it("a etiqueta sai ANTES dos pontos", () => {
    // `dono+nota.fiscal@` tem um ponto DENTRO da etiqueta. Tirando os pontos
    // primeiro, a identidade viraria `dononotafiscal@` — endereço nenhum.
    expect(emailIdentity("dono+nota.fiscal@gmail.com")).toBe("dono@gmail.com");
  });

  it("normaliza caixa alta e espaços da digitação", () => {
    expect(emailIdentity("  Dono+X@GMail.com ")).toBe("dono@gmail.com");
  });
});

describe("Outlook e família: só a etiqueta", () => {
  it.each([
    ["dono+x@outlook.com", "dono@outlook.com"],
    ["dono+x@hotmail.com", "dono@hotmail.com"],
    ["dono+x@live.com", "dono@live.com"],
    ["dono+x@icloud.com", "dono@icloud.com"],
    ["dono+x@proton.me", "dono@proton.me"],
  ])("%s → %s", (entrada, esperado) => {
    expect(emailIdentity(entrada)).toBe(esperado);
  });

  it("mantém os pontos: fora do Gmail eles fazem parte do endereço", () => {
    // `joao.silva@outlook.com` e `joaosilva@outlook.com` são DUAS contas. Juntar
    // as duas recusaria o cadastro de uma pessoa por causa da outra.
    expect(emailIdentity("joao.silva@outlook.com")).toBe("joao.silva@outlook.com");
    expect(mesmaIdentidadeDeEmail("joao.silva@outlook.com", "joaosilva@outlook.com")).toBe(false);
  });
});

describe("O que NÃO é normalizado", () => {
  it("domínio próprio fica como está — o comportamento dele é desconhecido", () => {
    // Um servidor corporativo pode tratar `+` como caractere comum do endereço.
    expect(emailIdentity("compras+hortifruti@empresa.com.br")).toBe(
      "compras+hortifruti@empresa.com.br",
    );
    expect(emailIdentity("joao.silva@empresa.com.br")).toBe("joao.silva@empresa.com.br");
  });

  it("Yahoo fica de fora: lá o separador é hífen, e hífen é nome de gente", () => {
    // `joao-silva@yahoo.com` pode ser um apelido de `joao@yahoo.com` OU o
    // endereço do João Silva. O ganho não paga o risco de confundir os dois.
    expect(emailIdentity("joao-silva@yahoo.com.br")).toBe("joao-silva@yahoo.com.br");
  });

  it("contas diferentes no mesmo provedor continuam diferentes", () => {
    expect(mesmaIdentidadeDeEmail("ana@gmail.com", "ana2@gmail.com")).toBe(false);
    expect(mesmaIdentidadeDeEmail("dono@gmail.com", "dono@outlook.com")).toBe(false);
  });
});

describe("Entrada estranha não vira identidade inventada", () => {
  it("texto sem arroba volta só em minúsculas", () => {
    expect(emailIdentity("  NAOEHEMAIL ")).toBe("naoehemail");
  });

  it("parte local que zeraria devolve o original", () => {
    // Sem esta guarda, `+a@gmail.com` e `+b@gmail.com` colidiriam numa
    // identidade vazia `@gmail.com` e bloqueariam um ao outro.
    expect(emailIdentity("+a@gmail.com")).toBe("+a@gmail.com");
    expect(emailIdentity("...@gmail.com")).toBe("...@gmail.com");
    expect(mesmaIdentidadeDeEmail("+a@gmail.com", "+b@gmail.com")).toBe(false);
  });

  it("arroba sobrando usa o ÚLTIMO como separador do domínio", () => {
    expect(emailIdentity('"a@b"+x@gmail.com')).toBe('"a@b"@gmail.com');
  });
});

describe("Simetria: a comparação é a mesma nos dois sentidos", () => {
  it("as três variações do mesmo dono batem entre si", () => {
    const variacoes = ["dono@gmail.com", "dono+1@gmail.com", "d.ono@googlemail.com"];
    for (const a of variacoes) {
      for (const b of variacoes) {
        expect(mesmaIdentidadeDeEmail(a, b), `${a} × ${b}`).toBe(true);
      }
    }
  });

  it("é idempotente: normalizar o já normalizado não muda nada", () => {
    const raiz = emailIdentity("d.o.n.o+nf@googlemail.com");
    expect(emailIdentity(raiz)).toBe(raiz);
  });
});
