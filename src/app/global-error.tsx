"use client";

import { useEffect } from "react";

/**
 * A última rede: erro no layout raiz, antes de qualquer shell existir.
 *
 * `error.tsx` embrulha `page`, `loading`, `not-found` e os layouts ANINHADOS —
 * mas não o layout do próprio segmento nem o layout raiz. Se `app/layout.tsx`
 * quebrar (provider, fonte, `Analytics`), nenhum boundary da árvore pega, e
 * sem este arquivo o usuário recebe a página 500 crua do framework.
 *
 * **Estilo inline não é desleixo — é exigência.** A documentação desta versão
 * do Next é explícita: `global-error` substitui o layout raiz e renderiza o
 * próprio documento, **sem** os estilos globais. Classe do Tailwind aqui não
 * aplica nada. Por isso as cores estão escritas à mão, com `color-scheme` para
 * o sistema operacional decidir claro ou escuro (o app não tem tema escuro
 * ligado hoje, e esta tela não pode depender disso).
 *
 * Pelo mesmo motivo o `<title>` é um elemento React, e não `export metadata`:
 * boundary é Client Component, e `metadata` não é suportado aqui.
 */
export default function ErroGlobal({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Erro global (layout raiz):", error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          colorScheme: "light dark",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        }}
      >
        <title>Erro — CeasaPro</title>
        <main style={{ maxWidth: "26rem", textAlign: "center" }}>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: "#1a7a3f" }}>
            CeasaPro
          </p>
          <h1 style={{ fontSize: "1.125rem", marginTop: "1.25rem", marginBottom: "0.5rem" }}>
            O aplicativo não conseguiu carregar
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.75, margin: 0 }}>
            O problema foi do nosso lado. Seus dados estão salvos — nada do que você
            lançou se perdeu.
          </p>

          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "1.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: "#fff",
              background: "#1a7a3f",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>

          {error.digest && (
            <p style={{ marginTop: "1.25rem", fontSize: "0.75rem", opacity: 0.6 }}>
              Código para o suporte: <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
