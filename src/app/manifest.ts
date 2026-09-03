import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CeasaPro — Gestão para o CEASA",
    short_name: "CeasaPro",
    description:
      "Gestão simples de produtos, vendas, fiado, estoque e financeiro para comerciantes do CEASA.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    // Rede de segurança do `display`: navegador que não implemente `standalone`
    // cai em `minimal-ui` (barra mínima) em vez de abrir uma aba comum. Sem esta
    // lista o fallback é direto para `browser`, que é o modo que o PWA existe
    // para evitar.
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1a7a3f",
    lang: "pt-BR",
    dir: "ltr",
    categories: ["business", "productivity"],
    /**
     * Atalhos do toque longo no ícone (Android e desktop; o iOS ignora).
     *
     * São só três, e são as três ações que alguém abre o app para fazer no meio
     * da operação do box. Repetir o menu inteiro aqui devolveria uma lista para
     * ler no lugar de um atalho — e atalho que exige leitura não economiza toque
     * nenhum. Todos apontam para telas do núcleo, nunca para módulo opcional:
     * o atalho é fixo no ícone e não sabe qual plano a empresa contratou.
     */
    shortcuts: [
      {
        name: "Nova venda",
        short_name: "Vender",
        url: "/vendas/nova",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Estoque",
        url: "/estoque",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Fiado",
        url: "/fiado",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Maskable dedicado com safe-zone (não corta na máscara circular do Android).
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
