"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Grafico, { COR as COR_BASE } from "@/components/Grafico";
import { useContagem } from "@/components/Kpi";
import { api, dado, fmt } from "@/lib/api";
import s from "./operacoes.module.css";

type AcaoRes = { transacoes: number; pct: number; fraudes: number; legitimas: number; valor_fraude: number };
type Pol = Record<"aprovar" | "autenticar" | "investigar", AcaoRes> & {
  n: number; fraudes: number; valor_fraudado: number; valor_fraude_sinalizado: number; valor_potencialmente_evitado: number;
  recall_valor_sinalizado: number; custo_total: number; custo_aprovar_tudo: number; beneficio_liquido_vs_aprovar_tudo: number;
  custo_operacional: number; custo_atrito: number; perda_residual: number;
};
type Dia = { dia: string; transacoes: number; fraudes: number; volume: number; valor_fraude: number; aprovar: number; autenticar: number; investigar: number; fraudes_sinalizadas: number };

// paleta v2 aplicada localmente aos gráficos desta página
const COR = { ...COR_BASE, protecao: "#3DDC97", risco: "#F0716A", atencao: "#E8B04A", intel: "#7FA7D9", zuper: "#19B36B", neutro: "#4A5A70", texto: "#E8EEF5", sub: "#A3B0C0" };

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
      <Grafico altura={290} data={[
        { type: "bar", orientation: "h", y: rot, x: base, marker: { color: "rgba(0,0,0,0)" }, hoverinfo: "skip", showlegend: false },
        { type: "bar", orientation: "h", y: rot, x: alt, marker: { color: cores }, text: textos, textposition: "outside", cliponaxis: false,
          textfont: { color: COR.texto, size: 11 }, customdata: dicas.map((d, i) => [textos[i], d]) as any, hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]}<extra></extra>", showlegend: false },
      ]} layout={{ barmode: "stack", bargap: 0.35, margin: { l: 96, r: 8, t: 8, b: 30 },
        yaxis: { autorange: "reversed", fixedrange: true, tickfont: { size: 11 }, showgrid: false }, xaxis: { tickprefix: "US$ ", tickformat: "~s", fixedrange: true, nticks: 3, range: [0, exp * 1.5] } }} />
    );
  }
  return (
    <Grafico altura={320} data={[
      { type: "bar", x: nomes, y: base, marker: { color: "rgba(0,0,0,0)" }, hoverinfo: "skip", showlegend: false },
      { type: "bar", x: nomes, y: alt, marker: { color: cores, line: { width: 0 } }, text: textos, textposition: "outside", cliponaxis: false,
        textfont: { color: COR.texto, size: 12 }, customdata: dicas.map((d, i) => [textos[i], d]) as any,
        hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]}<extra></extra>", showlegend: false },
    ]} layout={{ barmode: "stack", bargap: 0.52, margin: { l: 70, r: 8, t: 30, b: 52 },
      yaxis: { tickprefix: "US$ ", tickformat: "~s", range: [0, exp * 1.14], fixedrange: true, gridcolor: "#172130", zeroline: false },
      xaxis: { fixedrange: true, tickfont: { size: 12, color: COR.sub } },
      shapes: [0, 1, 2, 3].map((i) => ({ type: "line", xref: "x", yref: "y", x0: i + 0.24, x1: i + 0.76, y0: i === 0 ? exp : base[i], y1: i === 0 ? exp : base[i], line: { color: "#3A4A63", width: 1, dash: "dot" } })) as any,
    }} />
  );
}

const ACOES = [
  { k: "aprovar", nome: "Aprovar", ic: "✓", desc: "sem verificação adicional", cls: s.aprovar },
  { k: "autenticar", nome: "Pedir confirmação", ic: "!", desc: "o cliente confirma no app", cls: s.autenticar },
  { k: "investigar", nome: "Reter para análise", ic: "■", desc: "fila do analista", cls: s.investigar },
] as const;

function Fluxo({ p }: { p: Pol }) {
  return (
    <div className={s.fluxo} role="table" aria-label="Distribuição dos pagamentos pelas três ações">
      <div className={s.fluxoCab} role="row">
        <span role="columnheader">Ação</span>
        <span role="columnheader">Participação</span>
        <span role="columnheader" className={s.n}>Transações</span>
        <span role="columnheader" className={s.n}>Fraudes</span>
        <span role="columnheader" className={s.n}>Legítimas</span>
      </div>
      {ACOES.map((a) => {
        const q = p[a.k];
        return (
          <div key={a.k} className={`${s.fluxoLinha} ${a.cls}`} role="row">
            <span role="cell" className={s.acaoNome}><i aria-hidden>{a.ic}</i><span><b>{a.nome}</b><small>{a.desc}</small></span></span>
            <span role="cell" className={s.part}>
              <span className={s.pct}>{fmt.pct(q.pct, 2)}</span>
              <span className={s.trilho}><span style={{ width: `max(3px, ${q.pct * 100}%)` }} /></span>
            </span>
            <span role="cell" className={s.n}>{fmt.num(q.transacoes)}</span>
            <span role="cell" className={`${s.n} ${a.k === "aprovar" ? s.passou : ""}`}>{fmt.num(q.fraudes)}</span>
            <span role="cell" className={s.n}>{fmt.num(q.legitimas)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function CentroOperacoes() {
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

  if (res === false) return <div className="estado erro">Os artefatos de avaliação não foram encontrados. Rode o pipeline de treino para gerá-los.</div>;
  if (!res || !p) return <div className="grade" style={{ gap: 16 }}><div className="esqueleto" style={{ height: 60, width: 420 }} /><div className="esqueleto" style={{ height: 200 }} /><div className="esqueleto" style={{ height: 260 }} /></div>;

  const volume = serie && serie.length ? serie.reduce((t, d) => t + d.volume, 0) : null;
  const alertas = p.autenticar.transacoes + p.investigar.transacoes;
  const reducao = p.beneficio_liquido_vs_aprovar_tudo / p.custo_aprovar_tudo;
  const ch = res.teste[res.champion];
  const latInt = vivo?.latencia_ms?.interativo;
  const latRep = vivo?.latencia_ms?.replay;
  const mon = vivo?.monitoramento;
  const pctPolitica = p.custo_total / p.custo_aprovar_tudo;

  return (
    <>
      <header className="cabeca">
        <div>
          <h1>Centro de operações</h1>
          <p>Quanto a política antifraude protegeu, quanto custou operar e quantos clientes passaram sem nenhum atrito.</p>
          <div className="meta">
            <span className="selo teste">teste histórico</span>
            <span>{dataCurta(res.splits.test.inicio)} a {dataCurta(res.splits.test.fim)}, com a política congelada antes do período</span>
            <span>dados sintéticos em USD</span>
          </div>
        </div>
      </header>

      <section className={s.heroi} aria-labelledby="t-beneficio">
        <div className={s.heroiNum}>
          <h2 id="t-beneficio" className={s.heroiRot}>Benefício líquido simulado</h2>
          <div className="cifra xl protecao">{fmt.usd(beneficio)}</div>
          <p className={s.heroiTexto}>Custo total {fmt.pct(reducao, 1)} menor do que aprovar tudo, com {fmt.pct(p.aprovar.pct, 2)} dos pagamentos aprovados direto.</p>
          <div className={s.heroiAcoes}>
            <Link href="/simulador" className="btn primario">Abrir o simulador</Link>
            <Link href="/decisao" className="btn fantasma">Ver premissas de custo</Link>
          </div>
        </div>
        <div className={s.comparativo} aria-label="Custo total comparado">
          <div className={s.compLinha}>
            <div className={s.compTopo}><span>Se aprovasse tudo</span><b>{fmt.usd(p.custo_aprovar_tudo)}</b></div>
            <div className={s.compTrilho}><span className={s.compRisco} style={{ width: "100%" }} /></div>
          </div>
          <div className={s.compLinha}>
            <div className={s.compTopo}><span>Com a política de 3 níveis</span><b>{fmt.usd(p.custo_total)}</b></div>
            <div className={s.compTrilho}><span className={s.compProtecao} style={{ width: `${pctPolitica * 100}%` }} /></div>
          </div>
          <p className="legenda">Custo total é a fraude que passa, mais verificar e investigar, mais o atrito com clientes legítimos. Custos e eficácias são <span className="dica" tabIndex={0} data-dica="Valores hipotéticos editáveis na página Motor de decisão; num banco viriam de dados internos.">premissas</span>.</p>
        </div>
      </section>

      <section className={`metricas ${s.principais}`} aria-label="Indicadores principais">
        <div>
          <div className="rot">Valor potencialmente evitado</div>
          <div className="cifra l protecao">{fmt.usd(p.valor_potencialmente_evitado)}</div>
          <div className="legenda">valor sinalizado vezes a eficácia de cada ação</div>
        </div>
        <div>
          <div className="rot">Valor fraudado sinalizado</div>
          <div className="cifra l intel">{fmt.pct(p.recall_valor_sinalizado, 1)}</div>
          <div className="legenda">{fmt.usd(p.valor_fraude_sinalizado)} foram para confirmação ou análise</div>
        </div>
        <div>
          <div className="rot">Aprovação direta</div>
          <div className="cifra l">{fmt.pct(p.aprovar.pct, 2)}</div>
          <div className="legenda">{fmt.num(p.aprovar.transacoes)} pagamentos sem atrito</div>
        </div>
      </section>

      <dl className={s.secundarios} aria-label="Volume do período">
        <div><dt>Transações avaliadas</dt><dd>{fmt.num(p.n)}</dd></div>
        <div><dt>Volume transacionado</dt><dd>{fmt.usd(volume)}</dd></div>
        <div><dt>Fraudes confirmadas</dt><dd>{fmt.num(p.fraudes)} <small>{fmt.usd(p.valor_fraudado)}</small></dd></div>
        <div><dt>Taxa de alerta</dt><dd>{fmt.pct(alertas / p.n, 2)} <small>{fmt.num(alertas)} pagamentos</small></dd></div>
      </dl>

      <section className="bloco">
        <div className="lado">
          <h2>Do risco ao benefício</h2>
          <p>Quanto a fraude custaria sem proteção e quanto sobra depois dos custos da própria política: a perda que ainda passa, o custo de operar a análise e o incômodo causado a clientes bons.</p>
          <p><span className="selo premissa">depende de premissas</span></p>
        </div>
        <div className="corpo">
          <Cascata p={p} />
          <details className="inline">
            <summary>Ver detalhamento</summary>
            <table style={{ marginTop: 8 }}>
              <tbody>
                <tr><td>Perda se aprovasse tudo (exposição)</td><td className="n">{fmt.usd(p.custo_aprovar_tudo)}</td></tr>
                <tr><td>Perda residual (fraude que escapa ou passa da verificação)</td><td className="n">{fmt.usd(p.perda_residual)}</td></tr>
                <tr><td>Custo operacional (verificações e análises)</td><td className="n">{fmt.usd(p.custo_operacional)}</td></tr>
                <tr><td>Custo de atrito com clientes legítimos</td><td className="n">{fmt.usd(p.custo_atrito)}</td></tr>
                <tr className="destaque"><td>Benefício líquido simulado</td><td className="n">{fmt.usd(p.beneficio_liquido_vs_aprovar_tudo)}</td></tr>
                <tr><td>Valor potencialmente evitado (exposição menos perda residual)</td><td className="n">{fmt.usd(p.valor_potencialmente_evitado)}</td></tr>
              </tbody>
            </table>
            <p className="nota">Valor sinalizado não é valor protegido: a confirmação no app barra só uma parte das fraudes (premissa de eficácia).</p>
          </details>
        </div>
      </section>

      <section className="bloco">
        <div className="lado">
          <h2>Para onde vai cada pagamento</h2>
          <p>A política congelada distribui {fmt.num(p.n)} pagamentos em três ações. Quase todos passam direto; o alerta fica concentrado onde está a fraude.</p>
        </div>
        <div className="corpo">
          <Fluxo p={p} />
          <p className="nota">Barras proporcionais ao volume, com mínimo de 3 px para as ações pequenas continuarem visíveis. Taxa de alerta: {fmt.pct(alertas / p.n, 2)}. Fraudes em "Aprovar" são as que passaram sem alerta.</p>
        </div>
      </section>

      <details className="recolhe">
        <summary><span>Visão técnica do modelo<small>Champion, métricas de ranking e calibração no teste</small></span><span className="chev" aria-hidden>▾</span></summary>
        <div className="corpo">
          <div className="metricas">
            <div><div className="rot">Average precision (AP)</div><div className="cifra m">{ch.AP.toFixed(3)}</div><div className="legenda">acaso: {fmt.pct(ch.prevalencia, 2)}</div></div>
            <div><div className="rot">ROC-AUC</div><div className="cifra m">{ch.ROC_AUC.toFixed(4)}</div><div className="legenda">ordenação de risco</div></div>
            <div><div className="rot">Recall a 0,5% de falso positivo</div><div className="cifra m">{fmt.pct(ch["recall_fpr_0.5pct"], 1)}</div><div className="legenda">a 1%: {fmt.pct(ch["recall_fpr_1pct"], 1)}</div></div>
            <div><div className="rot">Brier calibrado</div><div className="cifra m">{res.calibracao.brier_teste.calibrado.toFixed(6)}</div><div className="legenda">bruto: {res.calibracao.brier_teste.bruto.toFixed(6)}, {res.calibracao.escolhida}</div></div>
          </div>
          <p className="nota">Champion: {res.champion}. Escolhido na janela de tuning, nunca no teste. A base é sintética e tem atalhos: trate essas métricas como teto otimista. <Link href="/lab">Abrir o Data Science Lab</Link></p>
          {serie && serie.length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>Decisões por dia no período de teste</h3>
              <Grafico altura={260} data={[
                { type: "bar", name: "Confirmação", x: serie.map((d) => d.dia), y: serie.map((d) => d.autenticar), marker: { color: COR.atencao } },
                { type: "bar", name: "Análise", x: serie.map((d) => d.dia), y: serie.map((d) => d.investigar), marker: { color: COR.risco } },
                { type: "scatter", mode: "lines", name: "Fraudes confirmadas", x: serie.map((d) => d.dia), y: serie.map((d) => d.fraudes), line: { color: COR.texto, width: 1.2 } },
              ]} layout={{ barmode: "stack", yaxis: { title: { text: "pagamentos por dia" } } }} />
            </>
          )}
        </div>
      </details>

      <section className={s.vivo} aria-label="Operação ao vivo">
        <div className={s.vivoCab}><h2>Operação ao vivo</h2><span className="selo vivo">ao vivo</span><span className={s.vivoSub}>API real com o replay do período de teste, atualizado a cada 10 s</span></div>
        {erroVivo ? <div className="estado erro">{erroVivo}. Os números acima vêm dos artefatos do teste e não dependem da API.</div> : (
          <dl className={s.secundarios}>
            <div><dt>Latência do simulador p50 / p95</dt><dd>{latInt?.n ? `${fmt.num(latInt.p50, 1)} / ${fmt.num(latInt.p95, 1)} ms` : "N/D"} <small>{latInt?.n ?? 0} medições</small></dd></div>
            <div><dt>Latência do replay p50 / p95</dt><dd>{latRep?.n ? `${fmt.num(latRep.p50, 1)} / ${fmt.num(latRep.p95, 1)} ms` : "N/D"} <small>{latRep?.n ?? 0} eventos</small></dd></div>
            <div><dt>Relógio virtual do replay</dt><dd>{mon?.relogio_virtual ? mon.relogio_virtual.slice(0, 10) : "N/D"} <small>{mon ? `${fmt.num(mon.eventos_processados)} de ${fmt.num(mon.total_periodo_teste)} eventos` : "replay parado"}</small></dd></div>
            <div><dt>Rótulos maduros</dt><dd>{mon ? fmt.pct(mon.rotulos.cobertura) : "N/D"} <small>{mon ? `${fmt.num(mon.rotulos.pendentes)} aguardando 30 dias` : "sem replay"}</small></dd></div>
          </dl>
        )}
      </section>
    </>
  );
}
