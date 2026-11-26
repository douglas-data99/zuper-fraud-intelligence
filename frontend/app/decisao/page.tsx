"use client";
import { useEffect, useMemo, useState } from "react";
import Grafico from "@/components/Grafico";
import { dado, fmt } from "@/lib/api";

type Amostra = { s: number[]; y: number[]; v: number[]; w: number[]; n_real: number; janela: string;
  politica_congelada: { t_auth: number; t_review: number }; premissas: Record<string, { custo_acao: number; atrito_legitimo: number; eficacia: number }> };
type Prem = { ca: number; ci: number; aa: number; ai: number; ea: number; ei: number };

function custoLinhas(d: Amostra, ta: number, tr: number, p: Prem) {
  let op = 0, atr = 0, perda = 0, tp = 0, fp = 0, fn = 0, tn = 0, nA = 0, nI = 0, valorSin = 0, valorTot = 0, tpI = 0, fpI = 0;
  for (let i = 0; i < d.s.length; i++) {
    const s = d.s[i], y = d.y[i], v = d.v[i], w = d.w[i];
    if (y) valorTot += v * w;
    if (s >= tr) { nI += w; op += p.ci * w; if (y) { perda += v * (1 - p.ei) * w; tp += w; tpI += w; valorSin += v * w; } else { atr += p.ai * w; fp += w; fpI += w; } }
    else if (s >= ta) { nA += w; op += p.ca * w; if (y) { perda += v * (1 - p.ea) * w; tp += w; valorSin += v * w; } else { atr += p.aa * w; fp += w; } }
    else { if (y) { perda += v * w; fn += w; } else tn += w; }
  }
  return { total: op + atr + perda, op, atr, perda, tp, fp, fn, tn, nA, nI, valorSin, valorTot, tpI, fpI };
}

function otimizar(d: Amostra, p: Prem) {
  const idx = d.s.map((_, i) => i).sort((a, b) => d.s[a] - d.s[b]);
  const n = idx.length;
  const pre = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)];
  for (let k = 0; k < n; k++) {
    const i = idx[k], y = d.y[i], v = d.v[i], w = d.w[i];
    pre[0][k + 1] = pre[0][k] + (y ? v * w : 0);
    pre[1][k + 1] = pre[1][k] + (p.ca + (y ? v * (1 - p.ea) : p.aa)) * w;
    pre[2][k + 1] = pre[2][k] + (p.ci + (y ? v * (1 - p.ei) : p.ai)) * w;
  }
  const G = 160, cand: number[] = [], pos: number[] = [];
  for (let g = 0; g < G; g++) { const k = Math.min(n - 1, Math.floor((g / (G - 1)) * (n - 1))); cand.push(d.s[idx[k]]); pos.push(k); }
  cand.push(1.0000001); pos.push(n);
  let melhor = { c: Infinity, ta: 1, tr: 1 };
  for (let a = 0; a < cand.length; a++) for (let b = a; b < cand.length; b++) {
    const ka = pos[a], kr = pos[b];
    const c = pre[0][ka] + (pre[1][kr] - pre[1][ka]) + (pre[2][n] - pre[2][kr]);
    if (c < melhor.c) melhor = { c, ta: Math.min(cand[a], 1), tr: Math.min(cand[b], 1) };
  }
  return melhor;
}

export default function Decisao() {
  const [d, setD] = useState<Amostra | null>(null);
  const [res, setRes] = useState<any>(null);
  const [curvas, setCurvas] = useState<any>(null);
  const [p, setP] = useState<Prem | null>(null);
  const [ta, setTa] = useState(0.01);
  const [tr, setTr] = useState(0.2);

  useEffect(() => {
    dado<Amostra>("politica_amostra.json").then((a) => {
      setD(a);
      const q = a.premissas;
      setP({ ca: q.autenticar.custo_acao, ci: q.investigar.custo_acao, aa: q.autenticar.atrito_legitimo, ai: q.investigar.atrito_legitimo, ea: q.autenticar.eficacia, ei: q.investigar.eficacia });
      setTa(a.politica_congelada.t_auth); setTr(a.politica_congelada.t_review);
    });
    dado<any>("resultados.json").then(setRes);
    dado<any>("curvas.json").then(setCurvas);
  }, []);

  const r = useMemo(() => (d && p ? custoLinhas(d, Math.min(ta, tr), tr, p) : null), [d, p, ta, tr]);
  const aprovarTudo = useMemo(() => (d ? d.s.reduce((acc, _, i) => acc + (d.y[i] ? d.v[i] * d.w[i] : 0), 0) : 0), [d]);
  if (!d || !p || !r) return <div className="estado">carregando…</div>;
  const prec = r.tp / Math.max(r.tp + r.fp, 1), rec = r.tp / Math.max(r.tp + r.fn, 1), f1 = (2 * prec * rec) / Math.max(prec + rec, 1e-9);
  const champ = curvas && Object.values<any>(curvas.modelos)[0];
  const campo = (k: keyof Prem, rot: string, max: number, passo: number) => (
    <div><label>{rot}: <b className="mono">{k.startsWith("e") ? fmt.pct(p[k], 0) : fmt.usd(p[k], 2)}</b></label>
      <input type="range" min={0} max={max} step={passo} value={p[k]} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} /></div>
  );
  const corte = (v: number, set: (n: number) => void, rot: string) => (
    <div><label>{rot}: <b className="mono">{v.toFixed(4)}</b></label>
      <input type="range" min={-4} max={0} step={0.01} value={Math.log10(Math.max(v, 1e-4))} onChange={(e) => set(Number(Math.pow(10, Number(e.target.value)).toFixed(5)))} /></div>
  );

  return (
    <>
      <span className="aviso">Exploração na janela de validação (policy) · o teste final usa a política congelada e não é ajustável aqui</span>
      <div className="cabeca"><div>
        <h1>Motor de decisão</h1>
        <p>O modelo dá o score; o motor decide. Mude os cortes e as premissas de custo e veja, em tempo real, perdas, atrito e fila de investigação.
          Mudar o corte <b>não</b> muda o modelo nem a AUC: muda só a operação.</p>
      </div></div>

      <div className="grade g3">
        <div className="card">
          <h2>Cortes</h2>
          {corte(ta, setTa, "Verificação a partir de (t_auth)")}
          {corte(tr, setTr, "Investigação a partir de (t_review)")}
          {ta > tr && <p className="nota" style={{ color: "var(--warn)" }}>t_auth maior que t_review: tratado como t_auth = t_review.</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => { const o = otimizar(d, p); setTa(o.ta); setTr(o.tr); }}>Otimizar com estas premissas</button>
            <button onClick={() => { setTa(d.politica_congelada.t_auth); setTr(d.politica_congelada.t_review); }}>Voltar à política congelada</button>
          </div>
        </div>
        <div className="card">
          <h2>Premissas <span className="selo premissa">hipóteses editáveis</span></h2>
          {campo("ca", "Custo de uma verificação", 5, 0.05)}
          {campo("ci", "Custo de uma investigação", 50, 0.5)}
          {campo("aa", "Atrito: cliente bom verificado", 20, 0.25)}
          {campo("ai", "Atrito: cliente bom retido", 100, 1)}
          {campo("ea", "Eficácia da verificação", 1, 0.05)}
          {campo("ei", "Eficácia da investigação", 1, 0.05)}
        </div>
        <div className="card">
          <h2>Resultado na janela policy</h2>
          <table><tbody>
            <tr><td>Perda se aprovasse tudo</td><td className="n">{fmt.usd(aprovarTudo)}</td></tr>
            <tr><td>Perda residual</td><td className="n">{fmt.usd(r.perda)}</td></tr>
            <tr><td>Custo operacional</td><td className="n">{fmt.usd(r.op)}</td></tr>
            <tr><td>Custo de atrito</td><td className="n">{fmt.usd(r.atr)}</td></tr>
            <tr className="destaque"><td><b>Benefício líquido</b></td><td className="n"><b>{fmt.usd(aprovarTudo - r.total)}</b></td></tr>
            <tr><td>Verificações / investigações</td><td className="n">{fmt.num(r.nA)} / {fmt.num(r.nI)}</td></tr>
            <tr><td>Fila de investigação</td><td className="n">{fmt.pct(r.nI / d.n_real, 2)} das transações</td></tr>
            <tr><td>Precisão / Recall / F1 (alerta = verificação ou investigação)</td><td className="n mono">{prec.toFixed(3)} / {rec.toFixed(3)} / {f1.toFixed(3)}</td></tr>
            <tr><td>Valor fraudulento sinalizado</td><td className="n">{fmt.pct(r.valorSin / Math.max(r.valorTot, 1))}</td></tr>
          </tbody></table>
          <p className="nota">Base: {fmt.num(d.n_real)} transações da janela policy (todas as fraudes + amostra ponderada de legítimas).</p>
        </div>
      </div>

      <div className="secao grade g2">
        <div className="card">
          <h2>Matriz de confusão do alerta</h2>
          <table><thead><tr><th></th><th className="n">Previsto alerta</th><th className="n">Previsto aprovar</th></tr></thead>
            <tbody>
              <tr><td>Fraude real</td><td className="n">{fmt.num(r.tp)} (VP)</td><td className="n">{fmt.num(r.fn)} (FN)</td></tr>
              <tr><td>Legítima real</td><td className="n">{fmt.num(r.fp)} (FP)</td><td className="n">{fmt.num(r.tn)} (VN)</td></tr>
            </tbody></table>
          <p className="nota">Contagens ponderadas pela amostragem das legítimas.</p>
        </div>
        {champ && (
          <div className="card">
            <h2>Curva precisão × recall do Champion (teste)</h2>
            <Grafico altura={280} data={[
              { type: "scatter", mode: "lines", x: champ.recall, y: champ.precision, name: "Champion", line: { color: "#3b82f6" } },
              { type: "scatter", mode: "markers", x: [rec], y: [prec], name: "ponto operacional (janela policy)", marker: { size: 12, color: "#f5a524" } },
            ]} layout={{ xaxis: { title: { text: "recall" } }, yaxis: { title: { text: "precisão" }, range: [0, 1.02] } }} />
            <p className="nota">Linha de base do acaso (prevalência no teste): {fmt.pct(curvas.prevalencia, 2)}.</p>
          </div>
        )}
      </div>

      {res && (
        <div className="secao card">
          <h2>Política congelada aplicada ao teste <span className="selo teste">não ajustável</span></h2>
          <div className="tabela-rolar"><table>
            <thead><tr><th>Política</th><th className="n">Aprovar</th><th className="n">Verificar</th><th className="n">Investigar</th><th className="n">Fraudes que passaram</th><th className="n">Custo total</th><th className="n">Benefício vs aprovar tudo</th></tr></thead>
            <tbody>
              {[["3 níveis (congelada)", res.politica_teste], ["1 corte (só investigar)", res.politica_1_corte_teste]].map(([n, q]: any) => (
                <tr key={n}><td>{n}</td><td className="n">{fmt.pct(q.aprovar.pct, 2)}</td><td className="n">{fmt.pct(q.autenticar.pct, 2)}</td><td className="n">{fmt.pct(q.investigar.pct, 2)}</td>
                  <td className="n">{fmt.num(q.aprovar.fraudes)}</td><td className="n">{fmt.usd(q.custo_total)}</td><td className="n">{fmt.usd(q.beneficio_liquido_vs_aprovar_tudo)}</td></tr>
              ))}
            </tbody></table></div>
          <h3 style={{ marginTop: 16 }}>Sensibilidade (reotimizada na janela policy)</h3>
          <div className="tabela-rolar"><table>
            <thead><tr><th>Cenário</th><th className="n">t_auth</th><th className="n">t_review</th><th className="n">% verificar</th><th className="n">% investigar</th><th className="n">Custo</th></tr></thead>
            <tbody>{Object.entries<any>(res.politica.sensibilidade).map(([k, v]) => (
              <tr key={k}><td className="mono">{k}</td><td className="n mono">{v.t_auth.toFixed(4)}</td><td className="n mono">{v.t_review.toFixed(4)}</td><td className="n">{fmt.pct(v.pct_autenticar, 2)}</td><td className="n">{fmt.pct(v.pct_investigar, 2)}</td><td className="n">{fmt.usd(v.custo_3_niveis)}</td></tr>
            ))}</tbody></table></div>
        </div>
      )}
    </>
  );
}
