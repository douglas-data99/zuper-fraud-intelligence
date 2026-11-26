"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import LogoZ from "./LogoZ";

export const REPO = "https://github.com/douglas-data99/zuper-fraud-intelligence";

const I = {
  painel: "M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z",
  rede: "M5 6a2 2 0 1 0 0-.01M19 6a2 2 0 1 0 0-.01M12 18a2 2 0 1 0 0-.01M5 8v3a3 3 0 0 0 3 3h3m8-6v3a3 3 0 0 1-3 3h-3m-1 0v2",
  cartao: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm0 4h18",
  balanca: "M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zm14 0-3 7a4 4 0 0 0 6 0z",
  frasco: "M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3",
  pulso: "M3 12h4l3-8 4 16 3-8h4",
  camadas: "m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5",
  codigo: "m8 8-5 4 5 4m8-8 5 4-5 4M14 4l-4 16",
};
function Icone({ d }: { d: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

const GRUPOS = [
  { nome: "", itens: [
    { href: "/", rotulo: "Como funciona", ic: I.rede },
  ] },
  { nome: "Negócio", itens: [
    { href: "/operacoes", rotulo: "Centro de operações", ic: I.painel },
    { href: "/simulador", rotulo: "Simulador bancário", ic: I.cartao },
    { href: "/decisao", rotulo: "Motor de decisão", ic: I.balanca },
  ] },
  { nome: "Tecnologia", itens: [
    { href: "/lab", rotulo: "Data Science Lab", ic: I.frasco },
    { href: "/monitoramento", rotulo: "Monitoramento do modelo", ic: I.pulso },
    { href: "/mlops", rotulo: "Engenharia e MLOps", ic: I.camadas },
  ] },
];

function Marca() {
  return (
    <Link href="/" className="marca" aria-label="Zuper Fraud Intelligence: como funciona">
      <span className="z"><LogoZ tamanho={18} /></span>
      <span><b>Zuper Fraud</b><small>Intelligence</small></span>
    </Link>
  );
}

export default function Lateral() {
  const atual = usePathname();
  const [aberta, setAberta] = useState(false);
  useEffect(() => setAberta(false), [atual]);
  useEffect(() => {
    if (!aberta) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberta(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberta]);

  return (
    <>
      <div className="topo-movel">
        <Marca />
        <button aria-label={aberta ? "Fechar menu" : "Abrir menu"} aria-expanded={aberta} aria-controls="menu-lateral" onClick={() => setAberta(!aberta)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            {aberta ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {aberta && <div className="veu" onClick={() => setAberta(false)} aria-hidden />}
      <aside id="menu-lateral" className={`lateral${aberta ? " aberta" : ""}`} aria-label="Navegação principal">
        <Marca />
        <nav className="nav">
          {GRUPOS.map((g) => (
            <div key={g.nome}>
              {g.nome && <div className="grupo">{g.nome}</div>}
              {g.itens.map((i) => (
                <Link key={i.href} href={i.href} aria-current={atual === i.href ? "page" : undefined}>
                  <Icone d={i.ic} />{i.rotulo}
                </Link>
              ))}
            </div>
          ))}
          <div className="grupo">Documentação</div>
          <a href={REPO} target="_blank" rel="noreferrer"><Icone d={I.codigo} />Evidências e código<span className="ext" aria-label="abre o GitHub">↗</span></a>
        </nav>
        <div className="rodape">
          <b>Dados sintéticos em USD</b>
          Projeto de portfólio de Douglas Caldeira Silva. Base pública Sparkov (CC0). Sem ligação com nenhum banco real.
        </div>
      </aside>
    </>
  );
}
