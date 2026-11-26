"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Grafico, { COR } from "@/components/Grafico";
import { Cabecalho, Kpi, useContagem } from "@/components/Kpi";
import { api, dado, fmt } from "@/lib/api";

type AcaoRes = { transacoes: number; pct: number; fraudes: number; legitimas: number; valor_fraude: number };
type Pol = Record<"aprovar" | "autenticar" | "investigar", AcaoRes> & {
  n: number; fraudes: number; valor_fraudado: number; valor_fraude_sinalizado: number; valor_potencialmente_evitado: number;
  recall_valor_sinalizado: number; custo_total: number; custo_aprovar_tudo: number; beneficio_liquido_vs_aprovar_tudo: number;
  custo_operacional: number; custo_atrito: number; perda_residual: number;
};
type Dia = { dia: string; transacoes: number; fraudes: number; volume: number; valor_fraude: number; aprovar: number; autenticar: number; investigar: number; fraudes_sinalizadas: number };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dataCurta = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split("-"); return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`; };

function Cascata({ p }: { p: Pol }) {
  // benefício líquido = exposição − perda residual − custo operacional − atrito (mesma conta de resumo_politica)
  const exp = p.custo_aprovar_tudo, perda = p.perda_residual, op = p.custo_operacional, atr = p.custo_atrito, ben = p.beneficio_liquido_vs_aprovar_tudo;
  const nomes = ["Exposição<br>(aprovar tudo)", "Perda residual", "Custo operacional", "Atrito com<br>clientes bons", "Benefício<br>líquido"];
  const topo = [exp, exp, exp - perda, exp - perda - op, ben];
  const base = [0, exp - perda, exp - perda - op, exp - perda - op - atr, 0];
  const alt = topo.map((t, i) => t - base[i]);
  const cores = [COR.neutro, COR.risco, COR.atencao, COR.atencao, COR.protecao];
  const textos = [fmt.usd(exp), `−${fmt.usd(perda)}`, `−${fmt.usd(op)}`, `−${fmt.usd(atr)}`, fmt.usd(ben)];
  const dicas = [
    "Perda se todas as transações fossem aprovadas: soma das fraudes do período",
    "Fraude que passou direto ou escapou da verificação (eficácia das ações é premissa)",
    "Custo de cada verificação e de cada análise de investigação (premissa)",
    "Custo de incomodar clientes legítimos com verificação ou retenção (premissa)",
    "Exposição menos os três custos: o que a política economiza contra aprovar tudo",
  ];
  const [estreito, setEstreito] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const f = () => setEstreito(mq.matches);
    f(); mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  if (estreito) {
    const rot = ["Exposição", "Perda residual", "Operação", "Atrito", "Benefício"];
    return (
      <Grafico altura={300} data={[
        { type: "bar", orientation: "h", y: rot, x: base, marker: { color: "rgba(0,0,0,0)" }, hoverinfo: "skip", showlegend: false },
        { type: "bar", orientation: "h", y: rot, x: alt, marker: { color: cores }, text: textos, textposition: "outside", cliponaxis: false,
          textfont: { color: COR.texto, size: 11 }, customdata: dicas.map((d, i) => [textos[i], d]) as any, hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]}<extra></extra>", showlegend: false },
      ]} layout={{ barmode: "stack", bargap: 0.3, margin: { l: 96, r: 8, t: 8, b: 30 },
        yaxis: { autorange: "reversed", fixedrange: true, tickfont: { size: 11 } }, xaxis: { tickprefix: "US$ ", tickformat: "~s", fixedrange: true, nticks: 3, range: [0, exp * 1.5] } }} />
    );
  }
  return (
    <Grafico altura={330} data={[
      { type: "bar", x: nomes, y: base, marker: { color: "rgba(0,0,0,0)" }, hoverinfo: "skip", showlegend: false },
      { type: "bar", x: nomes, y: alt, marker: { color: cores, line: { width: 0 } }, text: textos, textposition: "outside", cliponaxis: false,
        textfont: { color: COR.texto, size: 13 }, customdata: dicas.map((d, i) => [textos[i], d]) as any,
        hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]}<extra></extra>", showlegend: false },
    ]} layout={{ barmode: "stack", bargap: 0.38, margin: { l: 78, r: 10, t: 34, b: 56 },
      yaxis: { tickprefix: "US$ ", tickformat: "~s", range: [0, exp * 1.14], fixedrange: true },
      xaxis: { fixedrange: true, tickfont: { size: 12, color: COR.sub } },
      shapes: [0, 1, 2, 3].map((i) => ({ type: "line", xref: "x", yref: "y", x0: i + 0.31, x1: i + 0.69, y0: i === 0 ? exp : base[i], y1: i === 0 ? exp : base[i], line: { color: "#3A4A63", width: 1, dash: "dot" } })) as any,
    }} />
  );
}

function Fluxo({ p }: { p: Pol }) {
  const acoes = [
    { k: "aprovar", nome: "Aprovar", ic: "✓", desc: "sem verificação adicional", cor: COR.protecao },
    { k: "autenticar", nome: "Autenticar", ic: "!", desc: "pedido de confirmação", cor: COR.atencao },
    { k: "investigar", nome: "Investigar", ic: "■", desc: "fila de análise", cor: COR.risco },
  ] as const;
  const MAX = 88, MIN = 3, ys = [46, 148, 250];
  const esp = acoes.map((a) => Math.max(MIN, p[a.k].pct * MAX));
  let acum = 150 - esp.reduce((s, e) => s + e, 0) / 2;
  return (
    <div className="fluxo" role="figure" aria-label="Fluxo das transações avaliadas pelas três ações da política">
      <div className="origem">
        <div className="rot">Pagamentos avaliados</div>
        <div className="val">{fmt.num(p.n)}</div>
        <div className="nota" style={{ marginTop: 2 }}>{fmt.num(p.fraudes)} fraudes confirmadas</div>
      </div>
      <svg className="ligacoes" viewBox="0 0 200 300" preserveAspectRatio="none" aria-hidden>
        {acoes.map((a, i) => {
          const y0 = acum + esp[i] / 2; acum += esp[i];
          return <path key={a.k} className="desenha" d={`M0 ${y0} C 110 ${y0}, 90 ${ys[i]}, 200 ${ys[i]}`} stroke={a.cor} strokeWidth={esp[i]} strokeOpacity={i === 0 ? 0.85 : 1} style={{ animationDelay: `${0.1 + i * 0.12}s` }} />;
        })}
      </svg>
      <div className="destinos">
        {acoes.map((a) => (
          <div key={a.k} className={`destino ${a.k}`}>
            <div className="nome"><span aria-hidden>{a.ic}</span>{a.nome}</div>
            <div className="pct">{fmt.pct(p[a.k].pct, 2)}</div>
            <div className="info"><b>{fmt.num(p[a.k].transacoes)} transações</b>{a.desc}<br />
              <span style={{ color: a.k === "aprovar" ? COR.risco : COR.sub }}>{fmt.num(p[a.k].fraudes)} fraudes</span> · {fmt.num(p[a.k].legitimas)} legítimas</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VisaoExecutiva() {
  const [res, setRes] = useState<any>(null);
  const [serie, setSerie] = useState<Dia[] | null>(null);
  const [vivo, setVivo] = useState<any>(null);
  const [erroVivo, setErroVivo] = useState<string | null>(null);

  useEffect(() => {
    dado<any>("resultados.json").then(setRes).catch(() => setRes(false));
    dado<Dia[]>("serie_diaria_teste.json").then(setSerie).catch(() => setSerie([]));
    const ler = () => api<any>("/metrics").then((m) => { setVivo(m); setErroVivo(null); }).catch((e) => setErroVivo(e.message));
    ler();
    const t = setInterval(ler, 10000);
    return () => clearInterval(t);
  }, []);

  const p: Pol | null = res ? res.politica_teste : null;
  const beneficio = useContagem(p?.beneficio_liquido_vs_aprovar_tudo);

  if (res === false) return <div className="estado erro">Artefatos de avaliação ausentes. Rode o pipeline de treino.</div>;
  if (!res || !p) return <div className="grade" style={{ gap: 16 }}><div className="esqueleto" style={{ height: 70, width: 420 }} /><div className="esqueleto" style={{ height: 230 }} /><div className="esqueleto" style={{ height: 260 }} /></div>;

  const volume = serie && serie.length ? serie.reduce((s, d) => s + d.volume, 0) : null;
  const alertas = p.autenticar.transacoes + p.investigar.transacoes;
  const reducao = p.beneficio_liquido_vs_aprovar_tudo / p.custo_aprovar_tudo;
  const ch = res.teste[res.champion];
  const latInt = vivo?.latencia_ms?.interativo;
  const latRep = vivo?.latencia_ms?.replay;
  const mon = vivo?.monitoramento;

  return (
    <>
      <Cabecalho business eyebrow="Business · Visão executiva" titulo="Centro de operações">
        <div className="meta">
          <span className="selo teste">Teste histórico</span>
          <span>{dataCurta(res.splits.test.inicio)} a {dataCurta(res.splits.test.fim)}</span>
          <span>política congelada antes do teste</span>
          <span>dados sintéticos · USD</span>
        </div>
      </Cabecalho>

      <section className="heroi" aria-labelledby="t-beneficio">
        <div>
          <div className="rot" id="t-beneficio">Benefício líquido simulado</div>
          <div className="grande" aria-live="off">{fmt.usd(beneficio)}</div>
          <p className="sub"><b>{fmt.pct(reducao, 1)}</b> de redução simulada do custo total contra aprovar tudo, com <b>{fmt.pct(p.aprovar.pct, 2)}</b> dos clientes aprovados sem nenhum atrito.</p>
          <div className="acoes">
            <Link href="/simulador" className="btn primario">Abrir simulador bancário <span className="seta" aria-hidden>→</span></Link>
            <Link href="/decisao" className="btn">Ver premissas de custo</Link>
          </div>
        </div>
        <div className="comparativo" aria-label="Custo total comparado">
          <div className="linha">
            <div className="topo"><span>Custo se aprovasse tudo</span><b>{fmt.usd(p.custo_aprovar_tudo)}</b></div>
            <div className="trilho"><span style={{ width: "100%", background: COR.risco }} /></div>
          </div>
          <div className="linha">
            <div className="topo"><span>Custo com a política de 3 níveis</span><b>{fmt.usd(p.custo_total)}</b></div>
            <div className="trilho"><span style={{ width: `${(p.custo_total / p.custo_aprovar_tudo) * 100}%`, background: COR.protecao, animationDelay: ".2s" }} /></div>
          </div>
          <p className="nota">Custo total = perda com fraude + custo de verificar e investigar + atrito com clientes legítimos. Custos e eficácias são premissas editáveis.</p>
        </div>
      </section>

      <div className="grade g3 kpis" style={{ marginTop: 16 }}>
        <Kpi tom="protecao" rotulo="Valor potencialmente evitado" valor={fmt.usd(p.valor_potencialmente_evitado)} def="valor sinalizado × eficácia de cada ação" />
        <Kpi tom="intel" rotulo="Valor fraudado sinalizado" valor={fmt.pct(p.recall_valor_sinalizado, 1)} def={`${fmt.usd(p.valor_fraude_sinalizado)} caíram em verificação ou investigação`} />
        <Kpi tom="protecao" rotulo="Aprovação direta" valor={fmt.pct(p.aprovar.pct, 2)} def={`${fmt.num(p.aprovar.transacoes)} transações sem atrito`} />
        <Kpi rotulo="Transações avaliadas" valor={fmt.num(p.n)} def={`${fmt.usd(volume)} transacionados no período`} />
        <Kpi tom="atencao" rotulo="Taxa de alerta" valor={fmt.pct(alertas / p.n, 2)} def={`${fmt.num(alertas)} transações em verificação ou investigação`} />
        <Kpi tom="risco" rotulo="Fraudes confirmadas" valor={fmt.num(p.fraudes)} def={`${fmt.usd(p.valor_fraudado)} em valor fraudado`} />
      </div>

      <div className="secao grade g12">
        <div className="card c12">
          <div className="card-cab"><div><h2>Do risco ao benefício</h2><p>Quanto a fraude custaria e quanto sobra depois dos custos da própria política.</p></div><span className="selo premissa">depende de premissas</span></div>
          <Cascata p={p} />
          <details className="inline">
            <summary>Ver detalhamento ▾</summary>
            <table style={{ marginTop: 8 }}>
              <tbody>
                <tr><td>Perda se aprovasse tudo (exposição)</td><td className="n">{fmt.usd(p.custo_aprovar_tudo)}</td></tr>
                <tr><td>Perda residual (fraude que escapa ou passa da verificação)</td><td className="n">{fmt.usd(p.perda_residual)}</td></tr>
                <tr><td>Custo operacional (verificações + análises)</td><td className="n">{fmt.usd(p.custo_operacional)}</td></tr>
                <tr><td>Custo de atrito com clientes legítimos</td><td className="n">{fmt.usd(p.custo_atrito)}</td></tr>
                <tr className="destaque"><td><b>Benefício líquido simulado</b></td><td className="n"><b>{fmt.usd(p.beneficio_liquido_vs_aprovar_tudo)}</b></td></tr>
                <tr><td>Valor potencialmente evitado (exposição − perda residual)</td><td className="n">{fmt.usd(p.valor_potencialmente_evitado)}</td></tr>
              </tbody>
            </table>
            <p className="nota">Valor sinalizado ≠ valor protegido: a verificação adicional barra só uma parte das fraudes (premissa de eficácia).</p>
          </details>
        </div>
        <div className="card c12">
          <div className="card-cab"><div><h2>Para onde vai cada pagamento</h2><p>Decisão da política congelada em três níveis.</p></div></div>
          <Fluxo p={p} />
          <p className="nota">Espessura das faixas proporcional ao volume, com mínimo de 3 px para as faixas pequenas continuarem legíveis. Taxa de alerta: {fmt.pct(alertas / p.n, 2)}.</p>
        </div>
      </div>

      <details className="recolhe secao">
        <summary><span>Visão técnica do modelo <small>· Champion, métricas de ranking e calibração no teste</small></span><span className="chev" aria-hidden>▾</span></summary>
        <div className="corpo">
          <div className="grade g4">
            <Kpi tom="intel" rotulo="Average precision (AP)" valor={ch.AP.toFixed(3)} def={`linha de base do acaso: ${fmt.pct(ch.prevalencia, 2)}`} />
            <Kpi tom="intel" rotulo="ROC-AUC" valor={ch.ROC_AUC.toFixed(4)} def="ordenação de risco no teste" />
            <Kpi tom="intel" rotulo="Recall a 0,5% de falso positivo" valor={fmt.pct(ch["recall_fpr_0.5pct"], 1)} def={`a 1%: ${fmt.pct(ch["recall_fpr_1pct"], 1)}`} />
            <Kpi tom="intel" rotulo="Brier (calibrado)" valor={res.calibracao.brier_teste.calibrado.toFixed(6)} def={`bruto: ${res.calibracao.brier_teste.bruto.toFixed(6)} · ${res.calibracao.escolhida}`} />
          </div>
          <p className="nota">Champion: {res.champion}. Escolhido na janela de tuning, nunca no teste. A base é sintética e tem atalhos: trate essas métricas como teto otimista. <Link href="/lab">Abrir o Data Science Lab →</Link></p>
          {serie && serie.length > 0 && (
            <>
              <h3 style={{ marginTop: 18 }}>Decisões por dia no período de teste</h3>
              <Grafico altura={280} data={[
                { type: "bar", name: "Verificação", x: serie.map((d) => d.dia), y: serie.map((d) => d.autenticar), marker: { color: COR.atencao } },
                { type: "bar", name: "Investigação", x: serie.map((d) => d.dia), y: serie.map((d) => d.investigar), marker: { color: COR.risco } },
                { type: "scatter", mode: "lines", name: "Fraudes confirmadas", x: serie.map((d) => d.dia), y: serie.map((d) => d.fraudes), line: { color: COR.texto, width: 1.5 } },
              ]} layout={{ barmode: "stack", yaxis: { title: { text: "transações por dia" } } }} />
            </>
          )}
        </div>
      </details>

      <div className="secao">
        <div className="card-cab"><h2>Operação ao vivo</h2><span className="selo vivo">API real</span></div>
        {erroVivo ? <div className="estado erro">{erroVivo}. Os números históricos acima vêm dos artefatos do teste.</div> : (
          <div className="grade g4 kpis">
            <Kpi rotulo="Latência interativa p50 / p95" valor={latInt?.n ? `${fmt.num(latInt.p50, 1)} / ${fmt.num(latInt.p95, 1)} ms` : "N/D"} def={`${latInt?.n ?? 0} transações medidas no servidor`} selo="vivo" />
            <Kpi rotulo="Latência replay p50 / p95" valor={latRep?.n ? `${fmt.num(latRep.p50, 1)} / ${fmt.num(latRep.p95, 1)} ms` : "N/D"} def={`${latRep?.n ?? 0} eventos do replay`} selo="replay" />
            <Kpi rotulo="Relógio virtual do replay" valor={mon?.relogio_virtual ? mon.relogio_virtual.slice(0, 10) : "N/D"} def={mon ? `${fmt.num(mon.eventos_processados)} de ${fmt.num(mon.total_periodo_teste)} eventos` : "replay parado"} selo="replay" />
            <Kpi rotulo="Maturação dos rótulos" valor={mon ? fmt.pct(mon.rotulos.cobertura) : "N/D"} def={mon ? `${fmt.num(mon.rotulos.maduros)} maduros, ${fmt.num(mon.rotulos.pendentes)} aguardando 30 dias` : "sem replay"} selo="replay" />
          </div>
        )}
      </div>
    </>
  );
}
