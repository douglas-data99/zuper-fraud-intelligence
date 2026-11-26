"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, dado, fmt } from "@/lib/api";
import s from "./arquitetura.module.css";

/* Ilustração do fluxo do sistema. Nada aqui é inferência real: a pontuação de verdade acontece no simulador. */

type Faixa = 1 | 2 | 3;
type No = { k: string; nome: string; papel: string; faixa: Faixa; linha: number; logo?: string; glifo?: string };
type Etapa = { k: string; texto: string };

const NOS: No[] = [
  { k: "tx", nome: "Pagamento", papel: "cartão, valor, loja, horário", faixa: 1, linha: 1, glifo: "cartao" },
  { k: "api", nome: "FastAPI", papel: "recepção e validação", faixa: 1, linha: 2, logo: "/logos/fastapi.svg" },
  { k: "redis", nome: "Redis", papel: "feature store online", faixa: 1, linha: 3, logo: "/logos/redis.svg" },
  { k: "xgb", nome: "XGBoost", papel: "inferência", faixa: 1, linha: 4, logo: "/logos/xgboost.png" },
  { k: "score", nome: "Score calibrado", papel: "probabilidade estimada", faixa: 1, linha: 5, glifo: "medidor" },
  { k: "stream", nome: "Redis Streams", papel: "eventos assíncronos", faixa: 1, linha: 6, logo: "/logos/redis.svg" },
  { k: "worker", nome: "Worker Python", papel: "persistência com ACK", faixa: 1, linha: 7, logo: "/logos/python.svg" },
  { k: "bq", nome: "BigQuery", papel: "Bronze, Silver, Gold", faixa: 2, linha: 1, logo: "/logos/bigquery.png" },
  { k: "etl", nome: "SQL + Python", papel: "features point-in-time", faixa: 2, linha: 2, logo: "/logos/python.svg" },
  { k: "train", nome: "Treinamento", papel: "validação temporal", faixa: 2, linha: 3, logo: "/logos/scikitlearn.svg" },
  { k: "registry", nome: "MLflow", papel: "registro de modelos", faixa: 2, linha: 4, logo: "/logos/mlflow.png" },
  { k: "deploy", nome: "Serving", papel: "bundle versionado", faixa: 2, linha: 5, logo: "/logos/docker.svg" },
  { k: "monitor", nome: "Monitoramento", papel: "drift e rótulo atrasado", faixa: 2, linha: 6, glifo: "pulso" },
  { k: "decision", nome: "Motor de decisão", papel: "dois cortes por custo", faixa: 3, linha: 1, glifo: "balanca" },
  { k: "acoes", nome: "Ação", papel: "", faixa: 3, linha: 2 },
  { k: "analytics", nome: "Indicadores", papel: "operação e auditoria", faixa: 3, linha: 3, glifo: "barras" },
  { k: "benefit", nome: "Impacto financeiro", papel: "perda, custo e atrito", faixa: 3, linha: 4, glifo: "moeda" },
  { k: "client", nome: "Cliente", papel: "protegido, sem atrito", faixa: 3, linha: 5, glifo: "pessoa" },
];

const ETAPAS: Etapa[] = [
  { k: "tx", texto: "Um pagamento chega com cartão, valor, loja e horário." },
  { k: "api", texto: "A API valida o pedido e coordena a análise, em milissegundos." },
  { k: "redis", texto: "O histórico do cliente vem da memória, sem consultar o BigQuery no caminho crítico." },
  { k: "xgb", texto: "O modelo combina a compra atual com o comportamento do cartão." },
  { k: "score", texto: "O score calibrado estima a chance de fraude. Estima, não confirma." },
  { k: "decision", texto: "Dois cortes, escolhidos pelo custo, definem a ação: aprovar, pedir confirmação ou reter." },
  { k: "acoes", texto: "O cliente recebe a resposta. A maioria passa sem nenhum atrito." },
  { k: "stream", texto: "Transação, score e decisão viram um evento, fora do caminho do cliente." },
  { k: "worker", texto: "O worker consome o evento, evita duplicidade e só confirma depois de gravar." },
  { k: "bq", texto: "Tudo chega ao BigQuery, nas camadas Bronze, Silver e Gold." },
  { k: "etl", texto: "SQL e Python constroem as features respeitando o tempo: nada do futuro entra no passado." },
  { k: "analytics", texto: "Os registros alimentam indicadores de operação e trilha de auditoria." },
  { k: "benefit", texto: "Perda evitada, custo de análise e atrito com clientes bons entram na mesma conta." },
  { k: "client", texto: "O objetivo: proteger o dinheiro sem barrar quem é legítimo." },
  { k: "train", texto: "Em ciclo próprio, modelos são comparados em janelas de tempo separadas." },
  { k: "registry", texto: "O MLflow registra parâmetros, métricas e versões. Promoção é manual." },
  { k: "deploy", texto: "O bundle aprovado vai para a API. O challenger roda em sombra, sem decidir." },
  { k: "monitor", texto: "Drift, latência e rótulos que chegam depois indicam quando revisar o modelo." },
];

// ligações entre faixas: [origem, destino]
const ARESTAS: [string, string][] = [["score", "decision"], ["decision", "stream"], ["worker", "bq"], ["etl", "redis"], ["deploy", "xgb"], ["bq", "analytics"]];
const FAIXAS: Record<Faixa, { titulo: string; sub: string }> = {
  1: { titulo: "Operação em tempo real", sub: "o caminho do pagamento" },
  2: { titulo: "Dados e MLOps", sub: "o ciclo do modelo" },
  3: { titulo: "Decisão e impacto", sub: "o que o banco ganha" },
};
const CENARIOS = [
  { nome: "Baixo risco", acao: 0 },
  { nome: "Intermediário", acao: 1 },
  { nome: "Alto risco", acao: 2 },
];
const ACOES = [
  { nome: "Aprovar", cls: s.aprovar },
  { nome: "Confirmar", cls: s.autenticar },
  { nome: "Reter", cls: s.investigar },
];
const DURACAO = 3000;

function Glifo({ g }: { g: string }) {
  const d: Record<string, string> = {
    cartao: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm0 3h18M7 15h4",
    medidor: "M4 15a8 8 0 1 1 16 0M12 15l4-5",
    pulso: "M3 12h4l3-7 4 14 3-7h4",
    balanca: "M12 4v16M6 8h12M6 8l-3 6a3 3 0 0 0 6 0zm12 0-3 6a3 3 0 0 0 6 0zM8 20h8",
    barras: "M5 20V11m7 9V5m7 15v-6",
    moeda: "M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3S7.5 5.8 7.5 7.5 9.5 10.5 12 11s4.5 1.8 4.5 3.5-2 3-4.5 3-4.5-1.3-4.5-3",
    pessoa: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0",
  };
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d[g]} /></svg>;
}

/** caminho ortogonal com cantos arredondados */
function caminho(p: [number, number][], r = 7) {
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) { d += ` L${x1} ${y1}`; continue; }
    const ax = x1 - ((x1 - x0) / l1) * rr, ay = y1 - ((y1 - y0) / l1) * rr;
    const bx = x1 + ((x2 - x1) / l2) * rr, by = y1 + ((y2 - y1) / l2) * rr;
    d += ` L${ax} ${ay} Q${x1} ${y1} ${bx} ${by}`;
  }
  const u = p[p.length - 1];
  return d + ` L${u[0]} ${u[1]}`;
}

type Traco = { id: string; a: string; b: string; d: string; cruzado: boolean };

export default function ComoFunciona() {
  const [i, setI] = useState(-1);
  const [rodando, setRodando] = useState(false);
  const [pausaMouse, setPausaMouse] = useState(false);
  const [decorrido, setDecorrido] = useState(0);
  const [fim, setFim] = useState(false);
  const [cenario, setCenario] = useState(2);
  const [foco, setFoco] = useState<string | null>(null);
  const [tracos, setTracos] = useState<Traco[]>([]);
  const [caixa, setCaixa] = useState({ w: 0, h: 0 });
  const [reais, setReais] = useState<{ testes?: number; p50?: number; origem?: string }>({});
  const palco = useRef<HTMLDivElement>(null);
  const historico = useRef<HTMLOListElement>(null);
  const ultimo = useRef<number | null>(null);

  const mapa = useMemo(() => Object.fromEntries(NOS.map((n) => [n.k, n])), []);
  const etapaAtual = i >= 0 ? ETAPAS[i] : null;
  const vistos = useMemo(() => new Set(ETAPAS.slice(0, fim ? ETAPAS.length : i + 1).map((e) => e.k)), [i, fim]);
  const ativo = !fim && etapaAtual ? etapaAtual.k : null;
  const destaque = foco ?? ativo;

  // números reais do projeto (não da animação)
  useEffect(() => {
    dado<any>("teste_pytest.json").then((t) => setReais((r) => ({ ...r, testes: t.passaram }))).catch(() => {});
    api<any>("/metrics").then((m) => {
      const l = m?.latencia_ms;
      const fonte = l?.interativo?.n ? ["interativo", l.interativo] : l?.replay?.n ? ["replay", l.replay] : null;
      if (fonte) setReais((r) => ({ ...r, p50: fonte[1].p50, origem: fonte[0] as string }));
    }).catch(() => {});
  }, []);

  // desenho das ligações a partir da posição real de cada nó
  const desenhar = useCallback(() => {
    const el = palco.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const r = (k: string) => {
      const n = el.querySelector<HTMLElement>(`[data-no="${k}"]`);
      if (!n) return null;
      const q = n.getBoundingClientRect();
      return { l: q.left - b.left, r: q.right - b.left, t: q.top - b.top, bo: q.bottom - b.top, cx: (q.left + q.right) / 2 - b.left, cy: (q.top + q.bottom) / 2 - b.top };
    };
    const empilhado = window.innerWidth < 900;
    const out: Traco[] = [];
    // ligações dentro de cada faixa
    for (const f of [1, 2, 3] as Faixa[]) {
      const lista = NOS.filter((n) => n.faixa === f).sort((x, y) => x.linha - y.linha);
      for (let j = 0; j < lista.length - 1; j++) {
        const A = r(lista[j].k), B = r(lista[j + 1].k);
        if (!A || !B) continue;
        out.push({ id: `${lista[j].k}-${lista[j + 1].k}`, a: lista[j].k, b: lista[j + 1].k, d: `M${A.cx} ${A.bo + 3} L${B.cx} ${B.t - 3}`, cruzado: false });
      }
    }
    if (!empilhado) {
      const c1 = r("tx"), c2 = r("bq"), c3 = r("decision");
      if (c1 && c2 && c3) {
        const g1 = (c1.r + c2.l) / 2, g2 = (c2.r + c3.l) / 2;
        const lacuna = (linha: number) => { // y no meio do espaço acima da linha informada (faixa 2 como régua)
          const ac = NOS.find((n) => n.faixa === 2 && n.linha === linha - 1), ab = NOS.find((n) => n.faixa === 2 && n.linha === linha);
          const A = ac && r(ac.k), B = ab && r(ab.k);
          return A && B ? (A.bo + B.t) / 2 : 0;
        };
        const S = r("score")!, D = r("decision")!, ST = r("stream")!, W = r("worker")!, BQ = r("bq")!, E = r("etl")!, RD = r("redis")!, DP = r("deploy")!, X = r("xgb")!, AN = r("analytics")!;
        const y45 = lacuna(5), y56 = lacuna(6);
        const rotas: Record<string, [number, number][]> = {
          "score-decision": [[S.r, S.cy], [g1 + 12, S.cy], [g1 + 12, y45], [g2 - 8, y45], [g2 - 8, D.cy - 7], [D.l - 2, D.cy - 7]],
          "decision-stream": [[D.l, D.cy + 7], [g2, D.cy + 7], [g2, y56], [g1 + 12, y56], [g1 + 12, ST.cy], [ST.r + 2, ST.cy]],
          "worker-bq": [[W.r, W.cy], [g1 - 12, W.cy], [g1 - 12, BQ.cy], [BQ.l - 2, BQ.cy]],
          "etl-redis": [[E.l, E.cy], [g1 - 4, E.cy], [g1 - 4, RD.cy], [RD.r + 2, RD.cy]],
          "deploy-xgb": [[DP.l, DP.cy], [g1 + 4, DP.cy], [g1 + 4, X.cy], [X.r + 2, X.cy]],
          "bq-analytics": [[BQ.r, BQ.cy], [g2 + 8, BQ.cy], [g2 + 8, AN.cy], [AN.l - 2, AN.cy]],
        };
        for (const [a, c] of ARESTAS) out.push({ id: `${a}-${c}`, a, b: c, d: caminho(rotas[`${a}-${c}`]), cruzado: true });
      }
    }
    setCaixa({ w: b.width, h: b.height });
    setTracos(out);
  }, []);

  useLayoutEffect(() => {
    desenhar();
    const ro = new ResizeObserver(desenhar);
    if (palco.current) ro.observe(palco.current);
    return () => ro.disconnect();
  }, [desenhar]);

  // relógio da apresentação
  useEffect(() => {
    if (!rodando) { ultimo.current = null; return; }
    let raf = 0;
    const passo = (t: number) => {
      // o intervalo é calculado antes de atualizar a referência (o setState roda depois)
      const dt = ultimo.current == null ? 0 : Math.min(t - ultimo.current, 250);
      ultimo.current = t;
      if (dt > 0 && !pausaMouse) setDecorrido((e) => Math.min(DURACAO, e + dt));
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [rodando, pausaMouse]);

  useEffect(() => {
    if (!rodando || decorrido < DURACAO) return;
    if (i < ETAPAS.length - 1) { setI(i + 1); setDecorrido(0); }
    else { setRodando(false); setFim(true); setDecorrido(DURACAO); }
  }, [decorrido, rodando, i]);

  useEffect(() => { historico.current?.scrollTo({ top: historico.current.scrollHeight, behavior: "smooth" }); }, [i, fim]);

  const ir = useCallback((j: number) => { setI(Math.max(0, Math.min(ETAPAS.length - 1, j))); setDecorrido(0); setFim(false); }, []);
  const alternar = () => {
    if (rodando) { setRodando(false); return; }
    if (i < 0 || fim) { setI(0); setFim(false); setDecorrido(0); }
    setRodando(true);
  };
  const reiniciar = () => { setRodando(false); setI(-1); setDecorrido(0); setFim(false); };

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo.closest("input, select, textarea")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setRodando(false); ir(i + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setRodando(false); ir(i - 1); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [i, ir]);

  const noFoco = foco ? mapa[foco] : null;
  const titulo = noFoco ? noFoco.nome : fim ? "Do pagamento ao resultado." : etapaAtual ? mapa[etapaAtual.k].nome : "Um pagamento está chegando.";
  const texto = noFoco ? (ETAPAS.find((e) => e.k === noFoco.k)?.texto ?? noFoco.papel)
    : fim ? "Uma decisão em milissegundos, dados rastreáveis para auditoria e um ciclo que mantém o modelo honesto ao longo do tempo."
    : etapaAtual ? etapaAtual.texto : "Acompanhe, em 18 etapas, como o sistema decide e o que acontece depois da decisão.";
  const faixaAtual = noFoco ? noFoco.faixa : etapaAtual ? mapa[etapaAtual.k].faixa : null;
  const restante = ((DURACAO - decorrido) / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const acaoVisivel = vistos.has("decision");

  return (
    <div className={s.pagina}>
      <header className={s.topo}>
        <div>
          <h1 className={s.titulo}>Por trás de cada decisão.</h1>
          <p className={s.lead}>O caminho de um pagamento: da chegada à decisão, dos dados ao modelo, do alerta ao impacto financeiro.</p>
        </div>
        <nav className={s.atalhos} aria-label="Ir direto para">
          <Link href="/operacoes" className="btn">Resultados financeiros</Link>
          <Link href="/simulador" className="btn">Simulador bancário</Link>
        </nav>
      </header>

      <div className={s.controles}>
        <button className="primario" onClick={alternar} aria-label={rodando ? "Pausar apresentação" : "Iniciar apresentação"} style={{ minWidth: 132 }}>
          {rodando ? "Pausar" : fim ? "Assistir de novo" : i < 0 ? "Iniciar" : "Continuar"}
        </button>
        <div className={s.passos}>
          <button className="fantasma" onClick={() => { setRodando(false); ir(i - 1); }} disabled={i <= 0} aria-label="Etapa anterior">‹</button>
          <span className={s.contador} aria-live="polite">{i < 0 ? "—" : `${i + 1} de ${ETAPAS.length}`}</span>
          <button className="fantasma" onClick={() => { setRodando(false); ir(i + 1); }} disabled={i >= ETAPAS.length - 1} aria-label="Próxima etapa">›</button>
        </div>
        <button className="fantasma" onClick={reiniciar} disabled={i < 0}>Reiniciar</button>
        <div className={s.cenario}>
          <span>Cenário</span>
          <div className="segmentado" role="group" aria-label="Cenário ilustrativo">
            {CENARIOS.map((c, j) => <button key={c.nome} aria-pressed={cenario === j} onClick={() => setCenario(j)}>{c.nome}</button>)}
          </div>
        </div>
      </div>
      <div className={s.trilho} role="tablist" aria-label="Etapas">
        {ETAPAS.map((e, j) => (
          <button key={e.k} role="tab" aria-selected={j === i} aria-label={`Etapa ${j + 1}: ${mapa[e.k].nome}`} title={mapa[e.k].nome}
            className={`${s.marco} ${j <= i || fim ? s.marcoFeito : ""} ${s["faixa" + mapa[e.k].faixa]}`} onClick={() => { setRodando(false); ir(j); }} />
        ))}
      </div>

      <div className={s.area}>
        <div className={s.palco} ref={palco}>
          <svg className={s.ligacoes} width={caixa.w} height={caixa.h} viewBox={`0 0 ${caixa.w || 1} ${caixa.h || 1}`} aria-hidden>
            <defs>
              <marker id="ponta" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#2C3A4D" /></marker>
              <marker id="ponta-viva" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#2BCB80" /></marker>
            </defs>
            {tracos.map((t) => {
              const vivo = destaque != null && (t.a === destaque || t.b === destaque) && (foco != null || vistos.has(t.b) || t.b === destaque);
              const feito = vistos.has(t.a) && vistos.has(t.b);
              return <path key={t.id} d={t.d} className={`${s.traco} ${t.cruzado ? s.cruzado : ""} ${feito ? s.feito : ""} ${vivo ? s.vivo : ""}`} markerEnd={`url(#${vivo ? "ponta-viva" : "ponta"})`} />;
            })}
          </svg>
          {([1, 2, 3] as Faixa[]).map((f) => (
            <div key={f} className={`${s.faixa} ${faixaAtual === f ? s.faixaAtiva : ""}`} style={{ gridColumn: f, order: f * 100 }}>
              <span className={s.faixaNum}>{f}</span>
              <div><b>{FAIXAS[f].titulo}</b><small>{FAIXAS[f].sub}</small></div>
            </div>
          ))}
          {NOS.map((n) => n.k === "acoes" ? (
            <div key={n.k} data-no="acoes" className={`${s.acoes} ${acaoVisivel ? s.acoesOn : ""}`} style={{ gridColumn: n.faixa, gridRow: n.linha + 1, order: n.faixa * 100 + n.linha }}
              aria-label={acaoVisivel ? `Ação ilustrativa: ${ACOES[CENARIOS[cenario].acao].nome}` : "Ação ainda não definida"}>
              {ACOES.map((a, j) => <span key={a.nome} className={`${a.cls} ${acaoVisivel && CENARIOS[cenario].acao === j ? s.escolhida : ""}`}>{a.nome}</span>)}
            </div>
          ) : (
            <button key={n.k} data-no={n.k} style={{ gridColumn: n.faixa, gridRow: n.linha + 1, order: n.faixa * 100 + n.linha }}
              className={`${s.no} ${vistos.has(n.k) ? s.visto : ""} ${ativo === n.k ? s.ativo : ""} ${foco === n.k ? s.focado : ""}`}
              onMouseEnter={() => { setFoco(n.k); setPausaMouse(true); }} onMouseLeave={() => { setFoco(null); setPausaMouse(false); }}
              onFocus={() => setFoco(n.k)} onBlur={() => setFoco(null)}
              onClick={() => { const j = ETAPAS.findIndex((e) => e.k === n.k); if (j >= 0) { setRodando(false); ir(j); } }}
              aria-label={`${n.nome}: ${n.papel}`}>
              <span className={s.icone}>{n.logo ? <img src={n.logo} alt="" width={28} height={28} /> : <Glifo g={n.glifo!} />}</span>
              <span className={s.rotulo}><b>{n.nome}</b><small>{n.papel}</small></span>
            </button>
          ))}
        </div>

        <aside className={s.lado} aria-label="Narração da etapa">
          <div className={s.narracao} onMouseEnter={() => setPausaMouse(true)} onMouseLeave={() => setPausaMouse(false)}>
            <div className={s.faixaRot}>{faixaAtual ? FAIXAS[faixaAtual].titulo : "Arquitetura do sistema"}</div>
            <h2 className={s.etapaTitulo} key={titulo}>{titulo}</h2>
            <p className={s.etapaTexto}>{texto}</p>
            {fim && (
              <div className={s.fimAcoes}>
                <Link href="/operacoes" className="btn primario">Ver resultados financeiros</Link>
                <Link href="/simulador" className="btn">Testar no simulador</Link>
              </div>
            )}
          </div>
          <button className={s.progresso} onMouseEnter={() => setPausaMouse(true)} onMouseLeave={() => setPausaMouse(false)} onClick={alternar}
            aria-label={rodando ? "Pausar" : "Continuar"}>
            <span className={s.trilhoTempo}><i style={{ transform: `scaleX(${i < 0 ? 0 : decorrido / DURACAO})` }} /></span>
            <span className={s.tempo}>
              <span>{pausaMouse && rodando ? "Pausado enquanto o mouse está aqui" : rodando ? "Próxima etapa em" : i < 0 ? "Três segundos por etapa" : fim ? "Apresentação concluída" : "Pausado"}</span>
              <span className="mono">{rodando ? `${restante} s` : ""}</span>
            </span>
          </button>
          <ol className={s.historico} ref={historico} aria-label="Etapas concluídas">
            {ETAPAS.slice(0, fim ? ETAPAS.length : Math.max(0, i)).map((e, j) => (
              <li key={e.k}>
                <button onClick={() => { setRodando(false); ir(j); }}><span className={s["ponto" + mapa[e.k].faixa]} />{mapa[e.k].nome}</button>
                <p>{e.texto}</p>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <footer className={s.rodape}>
        <p className={s.aviso}><span className="selo ilustrativo">ilustração</span> <span>A animação mostra o caminho; a ação exibida depende do cenário escolhido, não de um modelo. Para uma pontuação real, use o <Link href="/simulador">simulador</Link>.</span></p>
        <p className={s.reais}>
          {reais.p50 != null && <span>Latência medida no servidor agora: <b>{fmt.num(reais.p50, 0)} ms</b> (p50, {reais.origem === "interativo" ? "transações do simulador" : "replay"})</span>}
          {reais.testes != null && <span><b>{reais.testes}</b> testes automatizados passando</span>}
          <span>Caminho síncrono sem BigQuery</span>
        </p>
      </footer>
    </div>
  );
}
