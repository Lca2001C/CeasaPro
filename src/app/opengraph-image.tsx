import { ImageResponse } from "next/og";
import { LANDING_OG_ALT } from "@/lib/seo/landing";

export const alt = LANDING_OG_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Imagem 1200×630 para WhatsApp, Facebook e Twitter.
 *
 * Arquivo de convenção do Next: vira `og:image` sozinho. Sem fonte custom —
 * o `ImageResponse` traz uma sans padrão; ler TTF no build quebraria o OG se o
 * arquivo faltasse no deploy.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#0f3d22",
          color: "#ffffff",
          padding: 80,
        }}
      >
        <div style={{ display: "flex", fontSize: 28, color: "#8fd4a8", marginBottom: 20 }}>
          CeasaPro
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 58,
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: 980,
          }}
        >
          Sistema de gestão para atacadistas e hortifrúti no CEASA
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#d4eadb", marginTop: 28 }}>
          Estoque · Caixaria · Vendas · Financeiro
        </div>
      </div>
    ),
    { ...size },
  );
}
