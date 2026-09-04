import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import { iosSplashLinks } from "@/lib/pwa/ios-splash";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CeasaPro — Gestão para comercializadores do CEASA",
  description:
    "Sistema simples de gestão de produtos, vendas, fiado, estoque, despesas e financeiro para comerciantes do CEASA.",
  verification: {
    google: "Ot8CbUdqquSApG960z4a2BMiH-mCUNWZj5uFkbqpxkM",
  },
  appleWebApp: {
    capable: true,
    title: "CeasaPro",
    statusBarStyle: "default",
  },
  icons: {
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
