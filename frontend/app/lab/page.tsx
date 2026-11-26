"use client";
import { useEffect, useState } from "react";
import Grafico, { COR } from "@/components/Grafico";
import { Cabecalho } from "@/components/Kpi";
import { dado, fmt } from "@/lib/api";

const REPO = "https://github.com/douglas-data99/zuper-fraud-intelligence";
const DESC: Record<string, string> = {
  amount_usd: "valor da compra", log_amount: "valor (log)", hour: "hora", weekday: "dia da semana", distance_to_merchant_km: "distância casa-loja",
  avg_amount_7d: "ticket médio 7d", avg_amount_30d: "ticket médio 30d", std_amount_30d: "desvio 30d", amount_vs_avg_30d: "valor ÷ ticket 30d",
  tx_count_30min: "compras 30 min", tx_count_24h: "compras 24 h", tx_count_7d: "compras 7d", tx_count_30d: "compras 30d", sum_amount_24h: "gasto 24 h",
  time_since_last_tx_s: "tempo desde a última", is_new_merchant: "loja nova", category_frequency_30d: "hábito na categoria",
  merchant_distinct_cards_30d: "movimento da loja", profile_history_count: "tamanho do histórico",
};

export default function Lab() {
  const [r, setR] = useState<any>(null);
  const [c, setC] = useState<any>(null);
  const [q, setQ] = useState<any>(null);
  const [ing, setIng] = useState<any>(null);
  useEffect(() => {
    dado<any>("resultados.json").then(setR);
    dado<any>("curvas.json").then(setC);
    dado<any>("qualidade_silver.json").then(setQ).catch(() => setQ(null));
    dado<any>("ingestao.json").then(setIng).catch(() => setIng(null));
  }, []);
  if (!r || !c) return <div className="estado">carregando…</div>;
  const nomes = Object.keys(r.teste);
  const cores = [COR.protecao, COR.intel, COR.atencao, COR.roxo, COR.risco, "#94a3B8", "#64748B"];
  const shap = Object.entries<number>(r.shap_top).slice(0, 12).reverse();
  const splits = Object.entries<any>(r.splits);
  const A = r.ablacao_A_vs_B_teste.A, B = r.ablacao_A_vs_B_teste.B;

  return (
    <>
      <Cabecalho eyebrow="Technology · Ciência de dados" titulo="Data Science Lab">
        <p>Dados, protocolo temporal, comparação de modelos, ablação de features, calibração, explicabilidade e limites. Código e relatório em <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>.</p>
        <div className="meta"><span>todos os números vêm dos artefatos gerados pela execução real do pipeline</span></div>
      </Cabecalho>

      <div className="grade g4 kpis">
        <div className="card kpi"><div className="rot">Transações</div><div className="val">{fmt.num(ing?.bronze?.linhas)}</div><div className="def">Sparkov (CC0) · {q ? `${fmt.num(Number(q.cartoes))} cartões, ${fmt.num(Number(q.merchants))} lojas` : "N/D"} · SHA-256 conferido na ingestão</div></div>
        <div className="card kpi"><div className="rot">Fraude no teste</div><div className="val">{fmt.pct(r.teste[r.champion].prevalencia, 2)}</div><div className="def">linha de base da curva PR (o acaso)</div></div>
        <div className="card kpi"><div className="rot">AP do Champion (teste)</div><div className="val">{r.teste[r.champion].AP.toFixed(3)}</div><div className="def">{r.champion}</div></div>
        <div className="card kpi"><div className="rot">Ganho do histórico (AP)</div><div className="val">+{((B.AP - A.AP) * 100).toFixed(1)} p.p.</div><div className="def">mesmas linhas de teste: {A.AP.toFixed(3)} → {B.AP.toFixed(3)}</div></div>
      </div>

      <div className="secao card">
        <h2>Protocolo temporal</h2>
        <p>O modelo aprende com o passado e é cobrado no futuro. Cada janela tem uma única função; o teste (arquivo de teste original) só é tocado depois de modelo, calibrador e política estarem salvos.</p>
        <div className="tabela-rolar"><table>
          <thead><tr><th>Janela</th><th>Função</th><th>Início</th><th>Fim</th><th className="n">Transações</th><th className="n">Fraudes</th></tr></thead>
          <tbody>{splits.map(([k, v]) => (
            <tr key={k}><td className="mono">{k}</td><td>{({ train: "ajuste dos modelos", tuning: "early stopping, Optuna, escolha do Champion", calibration: "calibrador de probabilidade", policy: "cortes da política de custo", test: "avaliação final (intocada)" } as any)[k]}</td>
              <td>{v.inicio.slice(0, 10)}</td><td>{v.fim.slice(0, 10)}</td><td className="n">{fmt.num(v.n)}</td><td className="n">{fmt.num(v.fraudes)}</td></tr>
          ))}</tbody></table></div>
        <p className="nota">Janeiro/2019 serve só como aquecimento do histórico. Features point-in-time: toda janela termina 1 segundo antes da transação (conferido por revisão independente em pandas e pelo teste automatizado de paridade offline × online).</p>
      </div>

      <div className="secao card">
        <h2>Comparação de modelos (teste)</h2>
        <div className="tabela-rolar"><table>
          <thead><tr><th>Modelo</th><th>Features</th><th className="n">AP (tuning)</th><th className="n">AP (teste)</th><th className="n">PR-AUC trapézio</th><th className="n">ROC-AUC</th><th className="n">Recall a 0,5% FPR</th><th className="n">Recall a 1% FPR</th></tr></thead>
          <tbody>{nomes.map((n) => (
            <tr key={n} className={n === r.champion ? "destaque" : ""}><td>{n}{n === r.champion ? " ★" : ""}{n === r.challenger ? " (challenger)" : ""}</td><td>{n.includes(" A") ? "A: transação" : n.includes("Dummy") ? "nenhuma" : "B: + histórico"}</td>
              <td className="n mono">{r.tuning[n]?.AP.toFixed(4)}</td><td className="n mono">{r.teste[n].AP.toFixed(4)}</td><td className="n mono">{r.teste[n].PR_AUC_trapezio.toFixed(4)}</td>
              <td className="n mono">{r.teste[n].ROC_AUC.toFixed(4)}</td><td className="n">{fmt.pct(r.teste[n]["recall_fpr_0.5pct"])}</td><td className="n">{fmt.pct(r.teste[n]["recall_fpr_1pct"])}</td></tr>
          ))}</tbody></table></div>
        <p className="nota">AP (average precision, soma em degraus) e PR-AUC por trapézio são cálculos diferentes e por isso aparecem separados. Champion escolhido pela AP na janela de tuning, não no teste.</p>
      </div>

      <div className="secao grade g2">
        <div className="card">
          <h2>Precisão × recall</h2>
          <Grafico data={Object.entries<any>(c.modelos).map(([n, m], i) => ({ type: "scatter", mode: "lines", name: `${n} (AP ${m.AP.toFixed(3)})`, x: m.recall, y: m.precision, line: { color: cores[i], width: i === 0 ? 2.5 : 1.4 } }))}
            layout={{ xaxis: { title: { text: "recall" } }, yaxis: { title: { text: "precisão" } }, shapes: [{ type: "line", x0: 0, x1: 1, y0: c.prevalencia, y1: c.prevalencia, line: { dash: "dot", color: "#7d8a9a" } }] }} />
        </div>
        <div className="card">
          <h2>ROC (zoom até 5% de FPR)</h2>
          <Grafico data={Object.entries<any>(c.modelos).map(([n, m], i) => ({ type: "scatter", mode: "lines", name: n, x: m.fpr.map((v: number) => v * 100), y: m.tpr.map((v: number) => v * 100), line: { color: cores[i], width: i === 0 ? 2.5 : 1.4 } }))}
            layout={{ xaxis: { title: { text: "% legítimas sinalizadas" }, range: [0, 5] }, yaxis: { title: { text: "% fraudes pegas" } } }} />
        </div>
      </div>

      <div className="secao grade g2">
        <div className="card">
          <h2>Calibração</h2>
          <Grafico data={[
            { type: "scatter", mode: "lines+markers", name: "bruto", x: c.calibracao.bruto.previsto, y: c.calibracao.bruto.observado, line: { color: "#94a3B8" } },
            { type: "scatter", mode: "lines+markers", name: `calibrado (${r.calibracao.escolhida})`, x: c.calibracao.calibrado.previsto, y: c.calibracao.calibrado.observado, line: { color: COR.protecao } },
            { type: "scatter", mode: "lines", name: "perfeito", x: [1e-5, 1], y: [1e-5, 1], line: { dash: "dot", color: "#7d8a9a" } },
          ]} layout={{ xaxis: { type: "log", title: { text: "probabilidade prevista" } }, yaxis: { type: "log", title: { text: "fraude observada" } } }} />
          <p className="nota">Brier no teste: bruto {r.calibracao.brier_teste.bruto.toFixed(5)} → calibrado {r.calibracao.brier_teste.calibrado.toFixed(5)}. Calibrador ajustado na janela calibration e escolhido (isotônico × sigmoide) na janela policy.</p>
        </div>
        <div className="card">
          <h2>O que mais pesa (SHAP global)</h2>
          <Grafico data={[{ type: "bar", orientation: "h", x: shap.map(([, v]) => v), y: shap.map(([k]) => DESC[k] || k.replace("cat_", "categoria: ")), marker: { color: COR.intel } }]}
            layout={{ margin: { l: 150, r: 10, t: 10, b: 40 }, xaxis: { title: { text: "média |SHAP| (log-odds do modelo bruto)" } } }} />
          <p className="nota">Explica o modelo, não a causa da fraude.</p>
        </div>
      </div>

      <div className="secao grade g2">
        <div className="card">
          <h2>Teste de estresse: atalhos do gerador</h2>
          <p>Na base Sparkov, nenhuma fraude passa de US$ 1.376 e fraudes vêm em rajada no mesmo cartão. Medimos quanto o modelo depende disso.</p>
          <table><thead><tr><th>Experimento</th><th className="n">AP teste</th><th className="n">Recall a 1% FPR</th></tr></thead>
            <tbody>
              <tr className="destaque"><td>Champion completo</td><td className="n mono">{B.AP.toFixed(4)}</td><td className="n">{fmt.pct(B.recall_fpr_1pct)}</td></tr>
              <tr><td>C1: sem features de valor</td><td className="n mono">{r.experimento_C_sem_valor.C1_sem_valor.teste.AP.toFixed(4)}</td><td className="n">{fmt.pct(r.experimento_C_sem_valor.C1_sem_valor.teste.recall_fpr_1pct)}</td></tr>
              <tr><td>C2: sem valor e sem rajada</td><td className="n mono">{r.experimento_C_sem_valor.C2_sem_valor_e_rajada.teste.AP.toFixed(4)}</td><td className="n">{fmt.pct(r.experimento_C_sem_valor.C2_sem_valor_e_rajada.teste.recall_fpr_1pct)}</td></tr>
              <tr><td>C4: sem tamanho do histórico e sem tempo desde a última</td><td className="n mono">{r.experimento_C_sem_valor.C4_sem_historico_curto.teste.AP.toFixed(4)}</td><td className="n">{fmt.pct(r.experimento_C_sem_valor.C4_sem_historico_curto.teste.recall_fpr_1pct)}</td></tr>
              <tr><td>C3: Champion só em compras &lt; US$ 800</td><td className="n mono">{r.experimento_C_sem_valor.C3_champion_abaixo_800.teste.AP.toFixed(4)}</td><td className="n">{fmt.pct(r.experimento_C_sem_valor.C3_champion_abaixo_800.teste.recall_fpr_1pct)}</td></tr>
            </tbody></table>
        </div>
        <div className="card">
          <h2>Desempenho por segmento (política congelada)</h2>
          <div className="tabela-rolar" style={{ maxHeight: 300, overflowY: "auto" }}><table>
            <thead><tr><th>Segmento</th><th className="n">Transações</th><th className="n">Fraudes</th><th className="n">AP</th><th className="n">Fraudes sinalizadas</th></tr></thead>
            <tbody>{["faixa_valor", "historico", "categoria"].flatMap((s) => Object.entries<any>(r.segmentos_teste[s]).map(([g, v]) => (
              <tr key={s + g}><td>{s === "faixa_valor" ? `US$ ${g}` : g}</td><td className="n">{fmt.num(v.n)}</td><td className="n">{fmt.num(v.fraudes)}</td><td className="n mono">{v.AP == null ? "N/D" : v.AP.toFixed(3)}</td><td className="n">{fmt.pct(v.recall_sinalizado)}</td></tr>
            )))}</tbody></table></div>
        </div>
      </div>

      {q && (
        <div className="secao card">
          <h2>Qualidade dos dados (Silver, BigQuery)</h2>
          <div className="grade g4">{Object.entries<string>(q).map(([k, v]) => <div key={k}><div className="nota">{k.replaceAll("_", " ")}</div><b className="mono">{v}</b></div>)}</div>
        </div>
      )}

      <div className="secao card">
        <h2>Limitações</h2>
        <ul>
          <li>Dados sintéticos: o gerador tem atalhos (teto de valor das fraudes, rajadas por cartão, horário noturno). Métricas tão altas não se transferem para um banco real.</li>
          <li>Sem dispositivo, IP, destinatário, saldo ou Pix: essas features não existem na base e não foram inventadas.</li>
          <li>Custos e eficácias da política são premissas; num banco viriam de dados internos.</li>
          <li>Fuso horário não informado na base; hora usada como está.</li>
          <li>Rótulo atrasado só é simulado no replay (a base não traz data de confirmação).</li>
        </ul>
      </div>
    </>
  );
}
