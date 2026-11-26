"use client";
import { useEffect, useMemo, useState } from "react";
import Grafico, { COR } from "@/components/Grafico";
import { Cabecalho } from "@/components/Kpi";
import { dado, fmt } from "@/lib/api";
import e from "./decisao.module.css";

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
  const rCong = useMemo(() => (d && p ? custoLinhas(d, Math.min(d.politica_congelada.t_auth, d.politica_congelada.t_review), d.politica_congelada.t_review, p) : null), [d, p]);
  const aprovarTudo = useMemo(() => (d ? d.s.reduce((acc, _, i) => acc + (d.y[i] ? d.v[i] * d.w[i] : 0), 0) : 0), [d]);
  if (!d || !p || !r || !rCong) return <div className="grade" style={{ gap: 16 }}><div className="esqueleto" style={{ height: 60, width: 380 }} /><div className="esqueleto" style={{ height: 420 }} /></div>;
  const prec = r.tp / Math.max(r.tp + r.fp, 1), rec = r.tp / Math.max(r.tp + r.fn, 1), f1 = (2 * prec * rec) / Math.max(prec + rec, 1e-9);
  const champ = curvas && Object.values<any>(curvas.modelos)[0];
  const beneficio = aprovarTudo - r.total, beneficioCong = aprovarTudo - rCong.total, delta = beneficio - beneficioCong;
  const congelada = Math.abs(ta - d.politica_congelada.t_auth) < 1e-9 && Math.abs(tr - d.politica_congelada.t_review) < 1e-9;

  const campo = (k: keyof Prem, rot: string, max: number, passo: number, dica: string) => (
    <div className={e.controle}>
      <div className={e.controleTopo}><label htmlFor={`p-${k}`} title={dica}>{rot}</label><b className="mono">{k.startsWith("e") ? fmt.pct(p[k], 0) : fmt.usd(p[k], 2)}</b></div>
      <input id={`p-${k}`} type="range" min={0} max={max} step={passo} value={p[k]} onChange={(ev) => setP({ ...p, [k]: Number(ev.target.value) })} />
    </div>
  );
  const corte = (v: number, set: (n: number) => void, rot: string, id: string) => (
    <div className={e.controle}>
      <div className={e.controleTopo}><label htmlFor={id}>{rot}</label><b className="mono">{fmt.pct(v, 2)}</b></div>
      <input id={id} type="range" min={-4} max={0} step={0.01} value={Math.log10(Math.max(v, 1e-4))} onChange={(ev) => set(Number(Math.pow(10, Number(ev.target.value)).toFixed(5)))} />
      <div className={e.escala}><span>0,01%</span><span>0,1%</span><span>1%</span><span>10%</span><span>100%</span></div>
    </div>
  );

  const linhas = ["Aprovar tudo", "Política congelada", "Seus cortes"];
  const perda = [aprovarTudo, rCong.perda, r.perda], oper = [0, rCong.op, r.op], atr = [0, rCong.atr, r.atr];
  const dica = (rot: string, v: number[]) => v.map((x, i) => `${linhas[i]}<br>${rot}: ${fmt.usd(x)}<extra></extra>`);

  return (
    <>
      <Cabecalho eyebrow="Negócio, política de risco" titulo="Motor de decisão">
        <p>O modelo estima o risco; o motor decide a ação. Mova os cortes e as premissas e veja como perda com fraude, custo de análise e atrito com clientes bons se compensam. Mudar o corte não muda o modelo: muda só a operação.</p>
        <div className="meta"><span className="selo premissa">validação 3 (policy)</span><span>{fmt.num(d.n_real)} transações de 01/05 a 21/06/2020, onde os cortes foram escolhidos</span><span>os números oficiais (teste) ficam no Centro de operações e no bloco do fim desta página</span></div>
      </Cabecalho>

      <div className={e.bancada}>
        <aside className={e.painel} aria-label="Controles da política">
          <section>
            <h2 className={e.painelTit}>Cortes da política</h2>
            {corte(ta, setTa, "Pedir verificação a partir de", "corte-auth")}
            {corte(tr, setTr, "Reter para investigação a partir de", "corte-review")}
            {ta > tr && <p className={e.alerta}>O corte de verificação está acima do de investigação: tratado como igual.</p>}
            <div className={e.botoes}>
              <button className="primario" onClick={() => { const o = otimizar(d, p); setTa(o.ta); setTr(o.tr); }}>Otimizar com estas premissas</button>
              <button onClick={() => { setTa(d.politica_congelada.t_auth); setTr(d.politica_congelada.t_review); }} disabled={congelada}>Voltar à política congelada</button>
            </div>
          </section>
          <section>
            <h2 className={e.painelTit}>Premissas financeiras <span className="selo premissa">hipóteses</span></h2>
            <p className={e.grupoRot}>Custo de cada ação</p>
            {campo("ca", "Verificação", 5, 0.05, "Custo de pedir confirmação ao cliente")}
            {campo("ci", "Investigação", 50, 0.5, "Custo de um analista revisar o caso")}
            <p className={e.grupoRot}>Atrito com cliente legítimo</p>
            {campo("aa", "Ao ser verificado", 20, 0.25, "Custo de incomodar um cliente bom com confirmação")}
            {campo("ai", "Ao ser retido", 100, 1, "Custo de reter a compra de um cliente bom")}
            <p className={e.grupoRot}>Eficácia contra a fraude</p>
            {campo("ea", "Da verificação", 1, 0.05, "Fração da fraude barrada pela confirmação")}
            {campo("ei", "Da investigação", 1, 0.05, "Fração da fraude barrada pela análise")}
          </section>
        </aside>

        <div className={e.resultado}>
          <section className={e.manchete}>
            <div>
              <div className={e.rot}>Benefício líquido contra aprovar tudo, na validação 3 (01/05 a 21/06/2020)</div>
              <div className={`cifra xl ${beneficio >= 0 ? "protecao" : "risco"}`}>{fmt.usd(beneficio)}</div>
              <div className="legenda">
                {congelada ? "Política congelada com as premissas atuais." :
                  <>Seus cortes {delta >= 0 ? "ganham" : "perdem"} <b style={{ color: delta >= 0 ? "var(--protecao)" : "var(--risco)" }}>{fmt.usd(Math.abs(delta))}</b> contra a política congelada, com as mesmas premissas.</>}
              </div>
            </div>
            <div className="metricas">
              <div><div className="rot">Fila de investigação</div><div className="cifra m">{fmt.pct(r.nI / d.n_real, 2)}</div><div className="legenda">{fmt.num(r.nI)} casos</div></div>
              <div><div className="rot">Verificações</div><div className="cifra m">{fmt.num(r.nA)}</div><div className="legenda">{fmt.pct(r.nA / d.n_real, 2)} das transações</div></div>
              <div><div className="rot">Valor fraudado sinalizado</div><div className="cifra m">{fmt.pct(r.valorSin / Math.max(r.valorTot, 1))}</div><div className="legenda">em verificação ou investigação</div></div>
            </div>
          </section>

          <section className={e.secao}>
            <div className={e.secaoCab}>
              <h2>Onde está o custo</h2>
              <p>Cada barra soma perda com fraude, custo de análise e atrito com clientes bons. Cortes mais baixos trocam perda por fila e atrito.</p>
            </div>
            <Grafico altura={230} data={[
              { type: "bar", orientation: "h", name: "Perda com fraude", y: linhas, x: perda, marker: { color: COR.risco }, hovertemplate: dica("Perda com fraude", perda) },
              { type: "bar", orientation: "h", name: "Custo de análise", y: linhas, x: oper, marker: { color: COR.intel }, hovertemplate: dica("Custo de análise", oper) },
              { type: "bar", orientation: "h", name: "Atrito com clientes bons", y: linhas, x: atr, marker: { color: COR.atencao }, hovertemplate: dica("Atrito", atr) },
            ]} layout={{ barmode: "stack", bargap: 0.42, margin: { l: 130, r: 16, t: 8, b: 40 }, legend: { orientation: "h", y: -0.28 },
              xaxis: { tickprefix: "US$ ", tickformat: "~s", fixedrange: true, rangemode: "tozero", nticks: 5 }, yaxis: { autorange: "reversed", fixedrange: true } }} />
            <table className={e.conta}>
              <tbody>
                <tr><td>Perda se aprovasse tudo</td><td className="n">{fmt.usd(aprovarTudo)}</td></tr>
                <tr><td>Perda residual</td><td className="n">{fmt.usd(r.perda)}</td></tr>
                <tr><td>Custo de análise</td><td className="n">{fmt.usd(r.op)}</td></tr>
                <tr><td>Atrito com clientes bons</td><td className="n">{fmt.usd(r.atr)}</td></tr>
                <tr className="destaque"><td>Benefício líquido</td><td className="n">{fmt.usd(beneficio)}</td></tr>
              </tbody>
            </table>
          </section>

          <section className={e.duas}>
            <div>
              <div className={e.secaoCab}><h2>Acertos e erros do alerta</h2><p>Alerta é verificação ou investigação. Contagens ponderadas pela amostra.</p></div>
              <table className={e.matriz}>
                <thead><tr><th></th><th className="n">Alertou</th><th className="n">Aprovou</th></tr></thead>
                <tbody>
                  <tr><td>Fraude</td><td className="n"><b style={{ color: "var(--protecao)" }}>{fmt.num(r.tp)}</b></td><td className="n"><b style={{ color: "var(--risco)" }}>{fmt.num(r.fn)}</b></td></tr>
                  <tr><td>Legítima</td><td className="n"><b style={{ color: "var(--atencao)" }}>{fmt.num(r.fp)}</b></td><td className="n">{fmt.num(r.tn)}</td></tr>
                </tbody>
              </table>
              <div className={`metricas ${e.mini}`}>
                <div><div className="rot">Precisão</div><div className="cifra m mono">{prec.toFixed(3)}</div></div>
                <div><div className="rot">Recall</div><div className="cifra m mono">{rec.toFixed(3)}</div></div>
                <div><div className="rot">F1</div><div className="cifra m mono">{f1.toFixed(3)}</div></div>
              </div>
            </div>
            {champ && (
              <div>
                <div className={e.secaoCab}><h2>Onde a política está na curva</h2><p>Curva precisão × recall do Champion no teste; o ponto é a sua política na validação 3 (policy).</p></div>
                <Grafico altura={260} data={[
                  { type: "scatter", mode: "lines", x: champ.recall, y: champ.precision, name: "Champion (teste)", line: { color: COR.intel, width: 2 } },
                  { type: "scatter", mode: "markers", x: [rec], y: [prec], name: "seus cortes", marker: { size: 12, color: COR.atencao, line: { color: "#0A0F16", width: 2 } } },
                ]} layout={{ margin: { l: 48, r: 10, t: 8, b: 44 }, legend: { x: 0.02, y: 0.06, xanchor: "left", yanchor: "bottom", orientation: "v", bgcolor: "rgba(10,15,22,.8)" }, xaxis: { title: { text: "recall" }, fixedrange: true }, yaxis: { title: { text: "precisão" }, range: [0, 1.02], fixedrange: true } }} />
                <p className="nota">Linha de base do acaso (prevalência no teste): {fmt.pct(curvas.prevalencia, 2)}.</p>
              </div>
            )}
          </section>
        </div>
      </div>

      {res && (
        <div className={`secao card ${e.congelado}`}>
          <div className={e.congeladoCab}>
            <div>
              <h2>Política congelada aplicada ao teste</h2>
              <p>Registro do resultado oficial: cortes escolhidos antes do teste, aplicados a {fmt.num(res.politica_teste.n)} transações de 21/06 a 31/12/2020. Somente leitura.</p>
            </div>
            <span className="selo teste">teste histórico</span>
          </div>
          <div className="tabela-rolar"><table>
            <thead><tr><th>Política</th><th className="n">Aprovar</th><th className="n">Verificar</th><th className="n">Investigar</th><th className="n">Fraudes que passaram</th><th className="n">Custo total</th><th className="n">Benefício contra aprovar tudo</th></tr></thead>
            <tbody>
              {[["Três níveis (congelada)", res.politica_teste], ["Um corte (só investigar)", res.politica_1_corte_teste]].map(([n, q]: any) => (
                <tr key={n}><td><b>{n}</b></td><td className="n">{fmt.pct(q.aprovar.pct, 2)}</td><td className="n">{fmt.pct(q.autenticar.pct, 2)}</td><td className="n">{fmt.pct(q.investigar.pct, 2)}</td>
                  <td className="n">{fmt.num(q.aprovar.fraudes)}</td><td className="n">{fmt.usd(q.custo_total)}</td><td className="n">{fmt.usd(q.beneficio_liquido_vs_aprovar_tudo)}</td></tr>
              ))}
            </tbody></table></div>
          <h3 className={e.subTit}>Sensibilidade dos cortes às premissas</h3>
          <p className="nota" style={{ marginTop: 0 }}>Cortes reotimizados na validação 3 (policy) quando cada premissa muda.</p>
          <div className="tabela-rolar"><table>
            <thead><tr><th>Cenário</th><th className="n">Verificar a partir de</th><th className="n">Investigar a partir de</th><th className="n">% verificar</th><th className="n">% investigar</th><th className="n">Custo</th></tr></thead>
            <tbody>{Object.entries<any>(res.politica.sensibilidade).map(([k, v]) => (
              <tr key={k}><td className="mono">{k}</td><td className="n mono">{v.t_auth.toFixed(4)}</td><td className="n mono">{v.t_review.toFixed(4)}</td><td className="n">{fmt.pct(v.pct_autenticar, 2)}</td><td className="n">{fmt.pct(v.pct_investigar, 2)}</td><td className="n">{fmt.usd(v.custo_3_niveis)}</td></tr>
            ))}</tbody></table></div>
        </div>
      )}
    </>
  );
}
