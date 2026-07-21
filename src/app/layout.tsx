import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import { iosSplashLinks } from "@/lib/pwa/ios-splash";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CeasaPro — Gestão para comercializadores do CEASA",
  description:
    "Sistema simples de gestão de produtos, vendas, fiado, estoque, despesas e financeiro para comerciantes do CEASA.",
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
      </body>
    </html>
  );
}
