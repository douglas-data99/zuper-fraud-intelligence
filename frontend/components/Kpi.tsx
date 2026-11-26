export function Kpi({ rotulo, valor, def, selo }: { rotulo: string; valor: string; def: string; selo?: "teste" | "replay" | "vivo" | "premissa" }) {
  const nomes = { teste: "teste histórico", replay: "replay", vivo: "ao vivo", premissa: "premissa" };
  return (
    <div className="card kpi">
      <div className="rot" style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
        <span>{rotulo}</span>
        {selo && <span className={`selo ${selo}`}>{nomes[selo]}</span>}
      </div>
      <div className="val">{valor}</div>
      <div className="def">{def}</div>
    </div>
  );
}

export function Acao({ a }: { a: string }) {
  const r: Record<string, string> = { aprovar: "Aprovar", autenticar: "Verificação adicional", investigar: "Reter para investigação" };
  const ic: Record<string, string> = { aprovar: "✓", autenticar: "!", investigar: "■" };
  return <span className={`acao ${a}`}><span aria-hidden>{ic[a]}</span>{r[a] ?? a}</span>;
}
