import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const isProd = process.env.NODE_ENV === "production";

// Cabeçalhos de segurança aplicados a todas as rotas (README §11).
//
// O Content-Security-Policy NÃO fica aqui: ele precisa de um nonce novo por
// requisição, e `headers()` só produz valores estáticos. Ele é montado em
// `src/proxy.ts`. Não duplique a diretiva neste arquivo — dois cabeçalhos CSP na
// mesma resposta são aplicados em conjunto (vale a interseção), e o mais frouxo
// aqui não afrouxaria nada, mas o mais estrito quebraria a página em silêncio.
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

// Versão do service worker: um valor por BUILD, registrado como `/sw.js?v=...`
// (ver `src/lib/pwa/sw-version.ts`). Na Vercel, o id da implantação — único por
// deploy, inclusive num redeploy do mesmo commit que só trocou variável
// `NEXT_PUBLIC_*` (e portanto os chunks). Fora dela, o commit; sem nenhum dos dois
// (build local), a hora do build. Gravado de volta em `process.env` para que o
// config, se for relido por outro processo do mesmo build, dê o MESMO valor.
process.env.CEASAPRO_SW_VERSION ||=
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // A foto do produto vai em base64 por Server Action (~1,37 MB no teto de 1 MB
  // de arquivo). O padrão de 1 MB do corpo derrubava o envio antes da validação.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // Substituído pelo literal no bundle; só `pwa-register.tsx` lê.
  env: { CEASAPRO_SW_VERSION: process.env.CEASAPRO_SW_VERSION },
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
      // A regra casa pelo caminho, então vale também para `/sw.js?v=<build>`.
      // `Service-Worker-Allowed: /` fixa o escopo máximo na raiz, o mesmo do
      // `register(..., { scope: "/" })`.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

/**
 * Source maps no Sentry — só com `SENTRY_AUTH_TOKEN` (+ `SENTRY_ORG` e
 * `SENTRY_PROJECT`) no ambiente do BUILD. Sem eles o config sai exatamente como
 * antes: o Sentry de runtime (`src/instrumentation*.ts`) funciona igual, só que a
 * pilha do navegador chega minificada.
 *
 * Com eles, o build envia os mapas e os APAGA da saída (`deleteSourcemapsAfterUpload`):
 * o código-fonte não fica público em `/_next/static`. Nada de instrumentação
 * automática nem túnel — o SDK aqui só serve para ler os erros.
 */
const comSourceMaps =
  !!process.env.SENTRY_AUTH_TOKEN && !!process.env.SENTRY_ORG && !!process.env.SENTRY_PROJECT;

export default comSourceMaps
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      telemetry: false,
      widenClientFileUpload: false,
      buildTimeInstrumentation: false,
      suppressOnRouterTransitionStartWarning: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;
