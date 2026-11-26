"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Grafico from "@/components/Grafico";
import { Cabecalho } from "@/components/Kpi";
import { dado, fmt } from "@/lib/api";
import s from "./monitoramento.module.css";

type Periodo = {
  periodo: string; inicio: string; fim: string; dias: number; rotulo_maduro: boolean; alarmes: string[];
  n: number; fraudes: number; prevalencia: number; alertas: number; taxa_alerta: number; aprovar: number; autenticar: number; investigar: number;
  recall: number | null; precisao_alerta: number | null; fraudes_que_passaram: number; valor_fraudado: number; valor_sinalizado: number;
  recall_valor: number | null; beneficio_liquido: number; AP: number | null; ROC_AUC: number | null; psi: Record<string, number | null>;
};
type Mon = {
  descricao: string; modelo: string; politica: string; maturacao_dias: number; limite_rotulo_maduro: string;
  regras_alarme: { recall_queda_pp: number; precisao_queda_pp: number; psi_atencao: number; psi_investigar: number; taxa_alerta_fator: number };
  referencia: Periodo & { janela: string; recall: number; precisao_alerta: number }; total_teste: Periodo; mensal: Periodo[]; semanal: Periodo[]; conferencia: string;
};

// paleta v2
const C = { protecao: "#3DDC97", risco: "#F0716A", atencao: "#E8B04A", intel: "#7FA7D9", zuper: "#19B36B", texto: "#E8EEF5", barra: "#243142" };

const SINAIS: Record<string, string> = {
  score: "Score do modelo", amount_usd: "Valor da compra", tx_count_24h: "Compras nas últimas 24 h",
  avg_amount_30d: "Ticket médio 30 dias", distance_to_merchant_km: "Distância casa-loja", time_since_last_tx_s: "Tempo desde a última compra",
};

const traduzir = (a: string) => Object.entries(SINAIS).reduce((t, [k, v]) => t.replace(k, v.toLowerCase()), a);
const virgula = (v: number) => v.toString().replace(".", ",");

function Psi({ v, r }: { v: number | null; r: Mon["regras_alarme"] }) {
  if (v == null) return <span className={s.psi}><i>amostra pequena</i></span>;
  const c = v >= r.psi_investigar ? "investigar" : v >= r.psi_atencao ? "atencao" : "estavel";
  const cls = c === "investigar" ? s.investigarP : c === "atencao" ? s.atencaoP : s.estavel;
  return <span className={`${s.psi} ${cls}`}>{v.toFixed(3)}<i>{c === "estavel" ? "estável" : c === "atencao" ? "atenção" : "investigar"}</i></span>;
}

export default function Monitoramento() {
  const [m, setM] = useState<Mon | null | false>(null);
  const [gran, setGran] = useState<"mensal" | "semanal">("mensal");
  useEffect(() => { dado<Mon>("monitoramento.json").then(setM).catch(() => setM(false)); }, []);

  const derivados = useMemo(() => {
    if (!m) return null;
    const maduros = m.mensal.filter((p) => p.rotulo_maduro);
    const ultimoMaduro = maduros[maduros.length - 1];
    const ultimo = m.mensal[m.mensal.length - 1];
    const comAlarme = m.mensal.filter((p) => p.alarmes.length);
    const piorRecall = maduros.reduce((a, b) => ((b.recall ?? 1) < (a.recall ?? 1) ? b : a), maduros[0]);
    const piorPsi = m.mensal.flatMap((p) => Object.entries(p.psi).map(([k, v]) => ({ k, v: v ?? 0, periodo: p.periodo }))).sort((a, b) => b.v - a.v)[0];
    const mediaVol = m.mensal.filter((p) => p !== ultimo).reduce((s, p) => s + p.n / p.dias, 0) / Math.max(m.mensal.length - 1, 1);
    const anteriores = m.mensal.filter((p) => p !== ultimo);
    const prevAnterior = anteriores.reduce((s, p) => s + p.fraudes, 0) / anteriores.reduce((s, p) => s + p.n, 0);
    return { maduros, ultimoMaduro, ultimo, comAlarme, piorRecall, piorPsi, picoVolume: (ultimo.n / ultimo.dias) / mediaVol, prevAnterior };
  }, [m]);

  if (m === false) return <div className="estado erro">Artefato de monitoramento ausente. Rode <code>python pipelines/monitoramento.py</code>.</div>;
  if (!m || !derivados) return <div className="grade" style={{ gap: 16 }}><div className="esqueleto" style={{ height: 70, width: 420 }} /><div className="esqueleto" style={{ height: 60 }} /><div className="esqueleto" style={{ height: 320 }} /></div>;

  const { ultimoMaduro, ultimo, comAlarme, piorRecall, piorPsi, picoVolume, prevAnterior } = derivados;
  const ref = m.referencia, r = m.regras_alarme;
  const serie = gran === "mensal" ? m.mensal : m.semanal;
  const x = serie.map((p) => (gran === "mensal" ? p.periodo : p.inicio));
  const imaturos = serie.filter((p) => !p.rotulo_maduro);
  const faixaImatura = imaturos.length ? [{ type: "rect", xref: "x", yref: "paper", x0: gran === "mensal" ? imaturos[0].periodo : imaturos[0].inicio, x1: x[x.length - 1], y0: 0, y1: 1,
    fillcolor: "rgba(232,176,74,.10)", line: { width: 0 }, layer: "below" }] : [];
  // em mensal o eixo é categórico: a faixa cobre a categoria inteira
  const shapesImaturo = gran === "mensal" && imaturos.length
    ? [{ type: "rect", xref: "x", yref: "paper", x0: m.mensal.length - imaturos.length - 0.5, x1: m.mensal.length - 0.5, y0: 0, y1: 1, fillcolor: "rgba(232,176,74,.10)", line: { width: 0 }, layer: "below" }]
    : faixaImatura;
  const linhaRef = (y: number, cor: string, dash = "dot") => ({ type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: y, y1: y, line: { color: cor, width: 1.2, dash } });
  const marcadorImaturo = serie.map((p) => (p.rotulo_maduro ? "circle" : "circle-open"));
  const estadoAtencao = comAlarme.length > 0;
  const tipoX = gran === "mensal" ? "category" : "date";
  const precisaoBaixa = (ultimoMaduro.precisao_alerta ?? 0) < ref.precisao_alerta - r.precisao_queda_pp;
  const corPsi = piorPsi.v >= r.psi_investigar ? s.risco : piorPsi.v >= r.psi_atencao ? s.atencaoC : s.protecao;

  return (
    <>
      <Cabecalho eyebrow="Tecnologia" titulo="Monitoramento do modelo"
        direita={<div className="segmentado" role="group" aria-label="Granularidade">
          <button aria-pressed={gran === "mensal"} onClick={() => setGran("mensal")}>Mensal</button>
          <button aria-pressed={gran === "semanal"} onClick={() => setGran("semanal")}>Semanal</button>
        </div>}>
        <p>O modelo continua acertando com casos que nunca viu? Modelo, calibrador e cortes foram <b>congelados antes</b> do período de teste.
          Aqui esses meses são reapresentados em ordem, como se fossem produção, e cada período é comparado com a referência da validação.</p>
        <div className="meta"><span className="mono">{m.modelo}</span><span>política {m.politica}</span><span>só inferência, nenhum retreino</span></div>
      </Cabecalho>

      <div className={`${s.status} ${estadoAtencao ? s.atencao : s.ok}`} role="status">
        <span className={s.tag}>{estadoAtencao ? "Atenção" : "Estável"}</span>
        <p>
          {estadoAtencao ? <><b>Alarmes em {comAlarme.map((p) => p.periodo).join(", ")}.</b> {ultimo.alarmes.length ? <>No período mais recente ({ultimo.periodo}): {ultimo.alarmes.map(traduzir).join("; ")}. </> : null}</>
            : <b>Nenhum alarme disparado. </b>}
          O recall do alerta ficou entre <b>{fmt.pct(Math.min(...m.mensal.map((p) => p.recall ?? 1)), 1)}</b> e <b>{fmt.pct(Math.max(...m.mensal.map((p) => p.recall ?? 0)), 1)}</b> em todos os meses
          (referência {fmt.pct(ref.recall, 1)}): o modelo segue pegando a fraude; o que oscila é a precisão dos alertas.
        </p>
      </div>

      <div className={s.indicadores}>
        <div className={s.principal}>
          <div className={s.rot}>Recall do alerta em {ultimoMaduro.periodo}</div>
          <div className={s.v}>{fmt.pct(ultimoMaduro.recall, 1)}</div>
          <div className={s.sub}>referência da validação: {fmt.pct(ref.recall, 1)}</div>
        </div>
        <div>
          <div className={s.rot}>Precisão do alerta em {ultimoMaduro.periodo}</div>
          <div className={`${s.v} ${precisaoBaixa ? s.atencaoC : s.intel}`}>{fmt.pct(ultimoMaduro.precisao_alerta, 1)}</div>
          <div className={s.sub}>referência: {fmt.pct(ref.precisao_alerta, 1)}; fraudes entre os alertados</div>
        </div>
        <div>
          <div className={s.rot}>AP em {ultimoMaduro.periodo}</div>
          <div className={`${s.v} ${s.intel}`}>{ultimoMaduro.AP?.toFixed(3) ?? "N/D"}</div>
          <div className={s.sub}>referência: {ref.AP?.toFixed(3)}; ordenação de risco</div>
        </div>
        <div>
          <div className={s.rot}>Maior drift (PSI)</div>
          <div className={`${s.v} ${corPsi}`}>{piorPsi.v.toFixed(2)}</div>
          <div className={s.sub}>{SINAIS[piorPsi.k] ?? piorPsi.k} em {piorPsi.periodo}</div>
        </div>
      </div>

      <section className="bloco">
        <div className="lado">
          <h2>Ele continua acertando?</h2>
          <p>Recall (fraudes pegas) e precisão (alertas que eram fraude), por {gran === "mensal" ? "mês" : "semana"}, contra a referência da validação.</p>
          <ul className={s.leitura}>
            <li><b>O modelo não perdeu a mão.</b>O pior mês maduro foi {piorRecall.periodo}, com recall de {fmt.pct(piorRecall.recall, 1)}; a AP mensal ficou entre {Math.min(...m.mensal.map((p) => p.AP ?? 1)).toFixed(3)} e {Math.max(...m.mensal.map((p) => p.AP ?? 0)).toFixed(3)}.</li>
            <li><b>{ultimo.periodo} é sazonal.</b>O volume diário foi {fmt.num(picoVolume, 1)}× a média dos meses anteriores (fim de ano), mas a fraude não acompanhou: a prevalência caiu para {fmt.pct(ultimo.prevalencia, 2)} (média anterior {fmt.pct(prevAnterior, 2)}). Com menos fraude no meio de mais compras, uma fatia maior dos alertas é cliente bom, e a precisão cai para {fmt.pct(ultimo.precisao_alerta, 1)}, mesmo com a taxa de alerta menor.</li>
            <li><b>Ação recomendada.</b>Não retreinar no escuro. Primeiro esperar a safra madurar, depois revisar os cortes para a sazonalidade e comparar com o challenger em sombra.</li>
          </ul>
        </div>
        <div className="corpo">
          {imaturos.length > 0 && <span className={s.legendaImaturo}><i aria-hidden />faixa âmbar: rótulo ainda não maduro</span>}
          <Grafico altura={360} data={[
            { type: "scatter", mode: "lines+markers", name: "Recall do alerta", x, y: serie.map((p) => p.recall), line: { color: C.protecao, width: 2.25, shape: "spline", smoothing: 0.5 }, marker: { size: 7, symbol: marcadorImaturo },
              hovertemplate: "%{x}<br>recall %{y:.1%}<extra></extra>" },
            { type: "scatter", mode: "lines+markers", name: "Precisão do alerta", x, y: serie.map((p) => p.precisao_alerta), line: { color: C.intel, width: 2.25, shape: "spline", smoothing: 0.5 }, marker: { size: 7, symbol: marcadorImaturo },
              hovertemplate: "%{x}<br>precisão %{y:.1%}<extra></extra>" },
          ]} layout={{ yaxis: { tickformat: ".0%", range: [0, 1.05], fixedrange: true }, xaxis: { fixedrange: true, type: tipoX },
            shapes: [...shapesImaturo, linhaRef(ref.recall, C.protecao), linhaRef(ref.precisao_alerta, C.intel),
              linhaRef(ref.precisao_alerta - r.precisao_queda_pp, C.atencao, "dash")] as any,
            annotations: [
              { xref: "paper", x: 1, y: ref.recall, yref: "y", text: "ref. recall", showarrow: false, xanchor: "right", yanchor: "bottom", font: { size: 10, color: C.protecao } },
              { xref: "paper", x: 1, y: ref.precisao_alerta - r.precisao_queda_pp, yref: "y", text: "alarme de precisão", showarrow: false, xanchor: "right", yanchor: "top", font: { size: 10, color: C.atencao } },
            ] as any }} />
          <p className="nota">Linhas pontilhadas: referência medida na janela de validação (policy), a última antes do congelamento. {gran === "semanal" ? "Semanas têm cerca de 70 fraudes: a precisão semanal oscila por acaso; os alarmes valem por mês." : ""} Marcador vazado: rótulo imaturo.</p>
        </div>
      </section>

      <section className="bloco">
        <div className="lado">
          <h2>Ordenação e capacidade</h2>
          <p>A AP independe dos cortes. O volume e a taxa de alerta mostram o primeiro limite operacional: a fila do time de análise.</p>
        </div>
        <div className="corpo">
          <div className={s.duas}>
            <div>
              <h3>Qualidade da ordenação (AP)</h3>
              <p className={s.desc}>Mede se o score continua separando fraude de legítima.</p>
              <Grafico altura={260} data={[
                { type: "bar", name: "AP", x, y: serie.map((p) => p.AP), marker: { color: serie.map((p) => (p.rotulo_maduro ? C.intel : "rgba(127,167,217,.35)")) }, hovertemplate: "%{x}<br>AP %{y:.3f}<extra></extra>" },
              ]} layout={{ yaxis: { range: [0.8, 1], fixedrange: true, tickformat: ".2f" }, xaxis: { fixedrange: true, type: tipoX }, showlegend: false, bargap: 0.45,
                shapes: [linhaRef(ref.AP ?? 0, C.texto)] as any }} />
              <p className="nota">Linha: AP de referência ({ref.AP?.toFixed(3)}). Eixo começa em 0,80 para mostrar as variações; barras claras = rótulo imaturo.</p>
            </div>
            <div>
              <h3>Volume e fila de alertas</h3>
              <p className={s.desc}>Transações por dia e a fração que vira verificação ou análise.</p>
              <Grafico altura={260} data={[
                { type: "bar", name: "Transações por dia", x, y: serie.map((p) => p.n / p.dias), marker: { color: C.barra }, hovertemplate: "%{x}<br>%{y:,.0f} transações/dia<extra></extra>" },
                { type: "scatter", mode: "lines+markers", name: "Taxa de alerta", x, y: serie.map((p) => p.taxa_alerta), yaxis: "y2", line: { color: C.atencao, width: 2.25 }, marker: { size: 6 }, hovertemplate: "%{x}<br>alerta %{y:.2%}<extra></extra>" },
              ]} layout={{ xaxis: { fixedrange: true, type: tipoX }, yaxis: { fixedrange: true, title: { text: "transações/dia" } }, bargap: 0.45,
                yaxis2: { overlaying: "y", side: "right", tickformat: ".1%", rangemode: "tozero", fixedrange: true, gridcolor: "rgba(0,0,0,0)" } as any,
                margin: { l: 56, r: 50, t: 24, b: 46 } }} />
            </div>
          </div>
        </div>
      </section>

      <section className="bloco">
        <div className="lado">
          <h2>Drift das entradas (PSI)</h2>
          <p>Distribuição de cada sinal comparada com a da validação. Abaixo de {virgula(r.psi_atencao)}: estável; de {virgula(r.psi_atencao)} a {virgula(r.psi_investigar)}: atenção; acima: investigar.</p>
        </div>
        <div className="corpo">
          <div className="tabela-rolar"><table>
            <thead><tr><th>Sinal</th>{m.mensal.map((p) => <th key={p.periodo} className="n">{p.periodo}</th>)}</tr></thead>
            <tbody>{Object.keys(SINAIS).map((k) => (
              <tr key={k}><td style={{ color: "var(--ink)" }}>{SINAIS[k]}</td>{m.mensal.map((p) => <td key={p.periodo} className="n"><Psi v={p.psi[k]} r={r} /></td>)}</tr>
            ))}</tbody>
          </table></div>
          <p className="nota">O score do modelo continua estável em todos os meses. O que muda no fim do ano é o ritmo de compra dos clientes (compras em 24 h e intervalo entre compras): é sazonalidade, e pede revisão dos cortes antes de qualquer retreino.</p>
        </div>
      </section>

      <section className="bloco">
        <div className="lado">
          <h2>Mês a mês</h2>
          <p>Todas as métricas recalculadas com o modelo congelado. A soma dos meses confere com o resultado oficial do teste.</p>
        </div>
        <div className="corpo">
          <div className="tabela-rolar"><table>
            <thead><tr><th>Mês</th><th className="n">Transações</th><th className="n">Fraudes</th><th className="n">Taxa de alerta</th><th className="n">Recall</th><th className="n">Precisão</th><th className="n">Valor sinalizado</th><th className="n">AP</th><th className="n">Benefício</th><th>Rótulo</th><th>Alarmes</th></tr></thead>
            <tbody>
              {m.mensal.map((p) => (
                <tr key={p.periodo}>
                  <td><b>{p.periodo}</b>{p.dias < 28 ? <span className={s.dias}>{p.dias} dias</span> : null}</td>
                  <td className="n">{fmt.num(p.n)}</td><td className="n">{fmt.num(p.fraudes)}</td><td className="n">{fmt.pct(p.taxa_alerta, 2)}</td>
                  <td className="n">{fmt.pct(p.recall, 1)}</td><td className="n">{fmt.pct(p.precisao_alerta, 1)}</td><td className="n">{fmt.pct(p.recall_valor, 1)}</td>
                  <td className="n mono">{p.AP?.toFixed(3)}</td><td className="n">{fmt.usd(p.beneficio_liquido)}</td>
                  <td><span className={`${s.rotulo} ${p.rotulo_maduro ? s.maduro : s.imaturo}`}>{p.rotulo_maduro ? "maduro" : "imaturo"}</span></td>
                  <td>{p.alarmes.length ? <span className={s.alarme}>{p.alarmes.map(traduzir).join("; ")}</span> : <span className={s.semAlarme}>nenhum</span>}</td>
                </tr>
              ))}
              <tr className="destaque"><td>Teste inteiro</td><td className="n">{fmt.num(m.total_teste.n)}</td><td className="n">{fmt.num(m.total_teste.fraudes)}</td><td className="n">{fmt.pct(m.total_teste.taxa_alerta, 2)}</td>
                <td className="n">{fmt.pct(m.total_teste.recall, 1)}</td><td className="n">{fmt.pct(m.total_teste.precisao_alerta, 1)}</td><td className="n">{fmt.pct(m.total_teste.recall_valor, 1)}</td>
                <td className="n mono">{m.total_teste.AP?.toFixed(3)}</td><td className="n">{fmt.usd(m.total_teste.beneficio_liquido)}</td><td></td><td></td></tr>
            </tbody>
          </table></div>
          <p className={s.fonte}>{m.conferencia}.</p>
        </div>
      </section>

      <section className="bloco">
        <div className="lado">
          <h2>Alarmes e resposta</h2>
          <p>Regras declaradas antes de olhar os resultados, como num runbook, avaliadas por mês.</p>
        </div>
        <div className="corpo">
          <div className={s.duas}>
            <div>
              <h3>Regras de alarme</h3>
              <table className={s.regras}><tbody>
                <tr><td>Recall do alerta</td><td className="n">cai mais de {fmt.num(r.recall_queda_pp * 100)} p.p. abaixo da referência</td></tr>
                <tr><td>Precisão do alerta</td><td className="n">cai mais de {fmt.num(r.precisao_queda_pp * 100)} p.p. abaixo da referência</td></tr>
                <tr><td>Taxa de alerta</td><td className="n">passa de {fmt.num(r.taxa_alerta_fator, 1)}× a referência (fila estoura)</td></tr>
                <tr><td>Drift (PSI) de um sinal</td><td className="n">≥ {virgula(r.psi_investigar)}</td></tr>
              </tbody></table>
              <p className="nota">Rótulo atrasado: em produção, a confirmação da fraude leva até {m.maturacao_dias} dias. Períodos que terminam depois de {m.limite_rotulo_maduro} ficam marcados como imaturos: aqui o rótulo existe porque a base é histórica, mas um banco ainda não o teria.</p>
            </div>
            <div>
              <h3>O que fazer quando dispara</h3>
              <ol className={s.passos} style={{ marginTop: 12 }}>
                <li><span><b>Confirmar a maturidade.</b> Recall de safra imatura é subestimado: esperar {m.maturacao_dias} dias antes de concluir.</span></li>
                <li><span><b>Achar a origem.</b> Drift no score indica problema no modelo; drift só nas entradas costuma ser sazonalidade ou mudança de público.</span></li>
                <li><span><b>Ajustar a operação primeiro.</b> Recalcular os cortes numa janela recente e madura (página <Link href="/decisao">Motor de decisão</Link>), sem mexer no modelo.</span></li>
                <li><span><b>Retreinar com aprovação.</b> Só com safra madura, comparando com o challenger em sombra; promoção manual pelo alias no MLflow, com rollback documentado.</span></li>
              </ol>
              <p className="nota">Procedimento documentado, não automatizado. O replay na VPS mostra a mesma lógica ao vivo (PSI e safra madura) em <Link href="/mlops">Engenharia e MLOps</Link>.</p>
            </div>
          </div>
        </div>
      </section>

      <p className={s.fonte} style={{ marginTop: 24 }}>Fonte: <code>reports/metrics/monitoramento.json</code>, gerado por <code>pipelines/monitoramento.py</code> com o bundle congelado.</p>
    </>
  );
}
