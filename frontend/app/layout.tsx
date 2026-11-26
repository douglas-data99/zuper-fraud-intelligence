import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navegacao from "@/components/Navegacao";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Zuper Fraud Intelligence",
  description: "Detecção de fraude em tempo real e decisão de risco. Projeto de portfólio com dados sintéticos públicos.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>
        <div className="shell">
          <aside className="lateral" aria-label="Navegação principal">
            <div className="marca">
              <div className="logo" aria-hidden>Z</div>
              <div>
                <b>Zuper Fraud Intelligence</b>
                <small>Real-Time Fraud Detection &amp; Risk Decisioning</small>
              </div>
            </div>
            <Navegacao />
            <div className="rodape">
              Projeto de portfólio de Douglas Caldeira Silva. Dados sintéticos públicos (Sparkov, CC0). Sem ligação com nenhum banco real.
            </div>
          </aside>
          <main className="conteudo">{children}</main>
        </div>
      </body>
    </html>
  );
}
