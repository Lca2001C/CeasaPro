import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import { iosSplashLinks } from "@/lib/pwa/ios-splash";
import { Analytics } from "@vercel/analytics/next";
import {
  CANONICAL_ORIGIN,
  LANDING_DESCRIPTION,
  LANDING_TITLE,
} from "@/lib/seo/landing";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN),
  title: LANDING_TITLE,
  description: LANDING_DESCRIPTION,
  verification: {
    google: "Ot8CbUdqquSApG960z4a2BMiH-mCUNWZj5uFkbqpxkM",
  },
  openGraph: {
    siteName: "CeasaPro",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
  appleWebApp: {
    capable: true,
    title: "CeasaPro",
    statusBarStyle: "default",
  },
  /**
   * O `.ico` NÃO entra nesta lista, de propósito.
   *
   * O Next trata as duas origens de ícone de formas diferentes, e a diferença
   * não é óbvia: `src/app/favicon.ico` é injetado com `icon.unshift(favicon)`
   * SEMPRE, mesmo quando este objeto existe; já os demais arquivos de convenção
   * (`icon.png`, `apple-icon.png`) são ignorados quando `metadata.icons` está
   * declarado. Declarar `/favicon.ico` aqui sairia como dois `<link>` iguais.
   *
   * O que se declara aqui é o que a convenção não dá: os PNG. O Google prefere
   * um favicon quadrado múltiplo de 48 para o resultado de busca, e o Android
   * usa o de 192 fora do manifesto. Os dois caminhos estão fora do matcher do
   * proxy (`icons/` e `favicon.ico$`), então um rastreador sem cookie os
   * alcança — `marca-e-favicon.test.ts` prende isso, porque um ícone que só
   * carrega para quem está logado é um ícone que o Google nunca vê.
   */
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1a7a3f",
  /**
   * `cover` faz o app instalado ocupar a tela INTEIRA do iPhone, inclusive sob a
   * barra de status e a barra de gestos — é o que tira a moldura branca e dá a
   * aparência de app nativo em vez de site salvo.
   *
   * O preço é que as barras fixas passam a precisar de recuo próprio
   * (`env(safe-area-inset-*)`): sem ele a navegação inferior fica parcialmente
   * atrás da barra de gestos e o toque nos rótulos vai para o sistema. Os recuos
   * estão em `AppShell`, `BottomNav`, `SupportButton` e `SheetContent`; mexer
   * aqui sem mexer lá reintroduz o problema.
   */
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* Splash screens do iOS (React 19 faz o hoist para o <head>). */}
        {iosSplashLinks.map((s) => (
          <link key={s.href + s.media} rel="apple-touch-startup-image" media={s.media} href={s.href} />
        ))}
        <Providers>{children}</Providers>
        <PwaRegister />
        <Analytics />
      </body>
    </html>
  );
}
