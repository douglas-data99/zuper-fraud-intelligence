import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Lateral from "@/components/Navegacao";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Zuper Fraud Intelligence",
  description: "Inteligência antifraude bancária: risco em tempo real, decisão por custo em três níveis e monitoramento do modelo. Projeto de portfólio com dados sintéticos públicos.",
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { themeColor: "#090E17", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <div className="shell">
          <Lateral />
          <main className="conteudo" id="conteudo">{children}</main>
        </div>
      </body>
    </html>
  );
}
