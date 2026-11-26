"use client";
import { useEffect, useRef, useState } from "react";

type Tom = "protecao" | "intel" | "risco" | "atencao" | "neutro";

export function Kpi({ rotulo, valor, def, selo, tom = "neutro" }: { rotulo: string; valor: string; def: string; selo?: "teste" | "replay" | "vivo" | "premissa"; tom?: Tom }) {
  const nomes = { teste: "teste histórico", replay: "replay", vivo: "ao vivo", premissa: "premissa" };
  return (
    <div className={`card kpi ${tom}`}>
      <div className="rot" style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
        <span>{rotulo}</span>
        {selo && <span className={`selo ${selo}`}>{nomes[selo]}</span>}
      </div>
      <div className="val">{valor}</div>
      <div className="def">{def}</div>
    </div>
  );
}

const NOME_ACAO: Record<string, string> = { aprovar: "Aprovar", autenticar: "Verificação adicional", investigar: "Reter para investigação" };
const ICONE_ACAO: Record<string, string> = { aprovar: "✓", autenticar: "!", investigar: "■" };
export function Acao({ a }: { a: string }) {
  return <span className={`acao ${a}`}><span aria-hidden>{ICONE_ACAO[a]}</span>{NOME_ACAO[a] ?? a}</span>;
}

/** Número que conta até o valor final (respeita prefers-reduced-motion). */
export function useContagem(alvo: number | null | undefined, ms = 900) {
  const [v, setV] = useState<number | null>(alvo ?? null);
  const feito = useRef(false);
  useEffect(() => {
    if (alvo == null) return;
    if (feito.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(alvo); return; }
    feito.current = true;
    const t0 = performance.now();
    let id = 0;
    const passo = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(alvo * (1 - Math.pow(1 - k, 3)));
      if (k < 1) id = requestAnimationFrame(passo);
    };
    id = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(id);
  }, [alvo, ms]);
  return v;
}

export function Cabecalho({ eyebrow, titulo, children, direita, business }: { eyebrow: string; titulo: string; children?: React.ReactNode; direita?: React.ReactNode; business?: boolean }) {
  return (
    <div className="cabeca">
      <div>
        <span className={`eyebrow${business ? " business" : ""}`}>{eyebrow}</span>
        <h1>{titulo}</h1>
        {children}
      </div>
      {direita}
    </div>
  );
}
