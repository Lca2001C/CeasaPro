import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Cabeçalhos de segurança aplicados a todas as rotas (README §11).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // HSTS só em produção (evita travar http://localhost em dev).
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Next 16 bloqueia por padrão o acesso a recursos de DEV (_next/*, incluindo o
  // WebSocket do HMR e os chunks de JS) vindo de origem != localhost. Ao acessar o
  // dev server por IP da LAN (ex.: celular/outro PC em http://192.168.x.x:3000) sem
  // isto, o JS do cliente NAO carrega e o login falha (form cai em submit nativo GET).
  // Ajuste os IPs/faixas conforme a sua rede local. Sem efeito em produção.
  allowedDevOrigins: [
    "192.168.0.209",
    "192.168.0.*",
    "192.168.1.*",
    "10.0.0.*",
    ...(process.env.DEV_ORIGIN ? [process.env.DEV_ORIGIN] : []),
  ],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // O service worker nunca deve ser cacheado — assim novas versões propagam na hora.
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
