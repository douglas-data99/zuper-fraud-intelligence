"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Acao, Cabecalho } from "@/components/Kpi";
import LogoZ from "@/components/LogoZ";
import { api, fmt, ROTULO_ACAO } from "@/lib/api";

type Cartao = { card_key: string; historico_total: number; ultimos_30d: number; categoria_mais_comum: string; ticket_medio_historico: number };
type Cenario = { tipo: string; descricao: string; card_key: string; merchant: string; categoria: string; amount_usd: number; hora: number; local: string; decisao_na_selecao: string };
type Loja = { merchant: string; categoria: string };
type Resp = any;

const LOCAIS: Record<string, string> = { perto_de_casa: "Perto de casa", cidade_vizinha: "Cidade vizinha (~50 km)", outro_estado: "Outro estado (~1.000 km)" };
const NOME_CEN: Record<string, string> = { habitual: "Habitual", ambiguo: "Ambíguo", atipico: "Atípico" };

function novoId() {
  return (crypto as any).randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function Simulador() {
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [cenarios, setCenarios] = useState<Cenario[]>([]);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [card, setCard] = useState<string>("");
  const [perfil, setPerfil] = useState<any>(null);
  const [form, setForm] = useState({ merchant: "", amount_usd: 50, hora: 14, local: "perto_de_casa" });
  const [resp, setResp] = useState<Resp | null>(null);
  const [hist, setHist] = useState<Resp[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [confirmado, setConfirmado] = useState(false);
  const pendente = useRef<Cenario | null>(null);   // cenário escolhido aguardando o perfil carregar
  const cardAtual = useRef<string>("");            // evita mostrar o histórico de um cartão no painel de outro

  useEffect(() => {
    Promise.all([api<Cartao[]>("/profiles?limite=60"), api<Cenario[]>("/scenarios"), api<Loja[]>("/merchants")])
      .then(([c, s, l]) => { setCartoes(c); setCenarios(s); setLojas(l); if (c[0]) setCard(c[0].card_key); })
      .catch((e) => setErro(e.message));
  }, []);

  useEffect(() => {
    if (!card) return;
    cardAtual.current = card;
    setPerfil(null);
    setHist([]);
    setResp(null);
    setStatus(null);
    api<any>(`/profiles/${card}`).then((p) => {
      if (p.card_key !== cardAtual.current) return;
      setPerfil(p);
      const c = pendente.current;
      if (c && c.card_key === card) {
        setForm({ merchant: c.merchant, amount_usd: c.amount_usd, hora: c.hora, local: c.local });
        pendente.current = null;
      } else {
        setForm((f) => ({ ...f, merchant: p.lojas_sugeridas?.[0] || f.merchant, amount_usd: Math.round((p.ultimos_30d.media || 50) * 100) / 100 }));
      }
    }).catch((e) => setErro(e.message));
  }, [card]);

  const lojasOrdenadas = useMemo(() => {
    const sug = new Set(perfil?.lojas_sugeridas || []);
    return [...lojas].sort((a, b) => Number(sug.has(b.merchant)) - Number(sug.has(a.merchant)) || a.categoria.localeCompare(b.categoria));
  }, [lojas, perfil]);

  const opcoesCartao = useMemo(() => {
    const extras = cenarios.filter((c) => !cartoes.some((k) => k.card_key === c.card_key))
      .map((c) => ({ card_key: c.card_key, historico_total: 0, ultimos_30d: 0, categoria_mais_comum: `cenário ${NOME_CEN[c.tipo]}`, ticket_medio_historico: 0 }));
    return [...extras, ...cartoes];
  }, [cartoes, cenarios]);

  async function enviar(gravar: boolean) {
    setCarregando(true); setErro(null); setStatus(null); setConfirmado(false);
    const corpo: any = { card_key: card, merchant: form.merchant, amount_usd: Number(form.amount_usd), hora: Number(form.hora), local: form.local };
    if (gravar) corpo.tx_id = novoId();
    try {
      const r = await api<Resp>(gravar ? "/transactions" : "/transactions/score", { method: "POST", body: JSON.stringify(corpo) });
      setResp(r);
      setHist((h) => [{ ...r, entrada: corpo }, ...h].slice(0, 8));
      if (gravar) acompanhar(r.transaction_id);
    } catch (e: any) { setErro(e.message); } finally { setCarregando(false); }
  }

  function acompanhar(id: string) {
    let n = 0;
    const t = setInterval(async () => {
      n++;
      try {
        const s = await api<any>(`/transactions/${id}`);
        setStatus(s);
        if ((s.event_status_atual || "").startsWith("persist") || (s.event_status_atual || "").startsWith("processado") || n > 20) {
          clearInterval(t);
          const alvo = cardAtual.current;
          api<any>(`/profiles/${alvo}`).then((p) => { if (p.card_key === cardAtual.current) setPerfil(p); }).catch(() => {});
        }
      } catch { if (n > 20) clearInterval(t); }
    }, 1500);
  }

  function aplicarCenario(c: Cenario) {
    setResp(null);
    if (c.card_key === card && perfil) {
      setForm({ merchant: c.merchant, amount_usd: c.amount_usd, hora: c.hora, local: c.local });
    } else {
      pendente.current = c;
      setCard(c.card_key);
    }
  }


  const ultimaEtapa = resp?.trilha?.length ? resp.trilha[resp.trilha.length - 1].ms : 0;
  const maxShap = resp ? Math.max(0.5, ...resp.reasons.itens.map((m: any) => Math.abs(m.contribuicao_log_odds))) : 1;
  // posição no medidor em escala log (scores calibrados ficam quase todos perto de zero)
  const posLog = (v: number) => Math.min(100, Math.max(0, ((Math.log10(Math.max(v, 1e-4)) + 4) / 4) * 100));
  const media30 = perfil?.ultimos_30d?.media;
  const razao = media30 ? Number(form.amount_usd) / media30 : null;
  const TITULO: Record<string, string> = { aprovar: "Pagamento aprovado", autenticar: "Confirme que é você", investigar: "Pagamento em análise" };

  return (
    <>
      <Cabecalho business eyebrow="Business · Demonstração funcional" titulo="Simulador bancário">
        <p>Escolha um cliente, monte a compra e veja a decisão <b>calculada de verdade</b> pela API: o histórico do cliente é lido do Redis (o navegador não envia histórico), o modelo pontua e o motor decide.</p>
        <div className="meta"><span>nenhuma transação real</span><span>resposta da API em tempo real</span><span>dados sintéticos · USD</span></div>
      </Cabecalho>
      {erro && <div className="estado erro" role="alert" style={{ marginBottom: 14 }}>{erro}. Nada foi aprovado por padrão: sem resposta da API, não há decisão.</div>}

      {cenarios.length > 0 && (
        <>
          <h3 style={{ marginBottom: 8 }}>Comece por um cenário reproduzível</h3>
          <div className="cenarios">
            {cenarios.map((c) => (
              <button key={c.tipo} className="cenario" onClick={() => aplicarCenario(c)}>
                <span className="t"><span>{NOME_CEN[c.tipo]}</span><span className="selo sem-ponto">{fmt.usd(c.amount_usd, 2)}</span></span>
                <span className="d">{c.descricao}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="sim">
        <div className="celular" aria-label="Aplicativo do banco (simulado)">
          <div className="tela">
            <div className="status"><span>{form.hora.toString().padStart(2, "0")}:00</span><span>Zuper Bank · fictício</span></div>
            <div className="banco"><span className="z"><LogoZ tamanho={11} /></span>Banco digital / demo</div>
            <h2>Pagamento com cartão</h2>
            <div className="valor-grande">
              <span>US$</span>
              <input aria-label="Valor da compra em dólares" type="number" min={1} max={30000} step="0.01" value={form.amount_usd} onChange={(e) => setForm({ ...form, amount_usd: Number(e.target.value) })} />
            </div>
            <div className="cartao-visual">
              <div style={{ opacity: .8 }}>cartão pseudonimizado</div>
              <div className="num">•••• •••• •••• {card.slice(-4)}</div>
              <span className="z"><LogoZ tamanho={16} /></span>
            </div>
            <div>
              <label htmlFor="card">Cliente</label>
              <select id="card" value={card} onChange={(e) => setCard(e.target.value)}>
                {opcoesCartao.map((c) => <option key={c.card_key} value={c.card_key}>{c.card_key.slice(0, 8)}… · {c.ultimos_30d ? `${c.ultimos_30d} compras/30d · ` : ""}{c.categoria_mais_comum}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="loja">Estabelecimento</label>
              <select id="loja" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })}>
                {lojasOrdenadas.map((l) => <option key={l.merchant} value={l.merchant}>{perfil?.lojas_sugeridas?.includes(l.merchant) ? "★ " : ""}{l.merchant} · {l.categoria}</option>)}
              </select>
            </div>
            <div className="grade g2" style={{ gap: 10 }}>
              <div><label htmlFor="hora">Hora</label><input id="hora" type="number" min={0} max={23} value={form.hora} onChange={(e) => setForm({ ...form, hora: Number(e.target.value) })} /></div>
              <div><label htmlFor="local">Onde está a loja</label>
                <select id="local" value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })}>
                  {Object.entries(LOCAIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
            </div>
            <button className="primario" style={{ padding: "12px 15px" }} disabled={!card || !form.merchant || carregando} onClick={() => enviar(true)}>{carregando ? "Processando…" : `Pagar ${fmt.usd(Number(form.amount_usd), 2)}`}</button>
            <button disabled={!card || !form.merchant || carregando} onClick={() => enviar(false)}>Simular sem gravar (what-if)</button>
            {resp && (
              <div className={`resultado-pag ${resp.decision}`} role="status">
                <div className="titulo"><Acao a={resp.decision} /></div>
                <b style={{ fontSize: "1.02rem" }}>{TITULO[resp.decision]}</b>
                <span className="nota" style={{ margin: 0 }}>{resp.modo === "transação" ? "Transação registrada com evento" : "What-if: nada foi gravado"}</span>
                {resp.decision === "autenticar" && resp.modo === "transação" && (
                  <button style={{ width: "100%" }} onClick={() => setConfirmado(true)} disabled={confirmado}>
                    {confirmado ? "Confirmado (simulação)" : "Confirmar no app (confirmação fictícia)"}
                  </button>
                )}
                {resp.decision === "investigar" && <span className="nota" style={{ margin: 0 }}>Pagamento retido para análise. Alerta não é prova de fraude.</span>}
              </div>
            )}
          </div>
        </div>

        <div className="grade" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-cab"><div><h2>Perfil comportamental</h2><p>Features reais do cliente, lidas da feature store online.</p></div><span className="selo sem-ponto">Redis</span></div>
            {!perfil ? (erro ? <div className="estado">Perfil indisponível: a API não respondeu.</div> : <div className="esqueleto" style={{ height: 150 }} aria-label="carregando perfil" />) : (
              <>
                <div className="comparacao-atual">
                  <div className="item"><div className="r">Compra atual</div><b>{fmt.usd(Number(form.amount_usd), 2)}</b></div>
                  <div className="item"><div className="r">Média 30 dias</div><b>{fmt.usd(perfil.ultimos_30d.media, 2)}</b></div>
                  <div className="item"><div className="r">Compra ÷ média</div><b style={{ color: razao == null ? undefined : razao > 5 ? "var(--risco)" : razao > 2 ? "var(--atencao)" : "var(--protecao)" }}>{razao == null ? "sem histórico" : `${fmt.num(razao, 1)}×`}</b></div>
                  <div className="item"><div className="r">Compras em 30 dias</div><b>{fmt.num(perfil.ultimos_30d.transacoes)}</b></div>
                </div>
                <p className="nota">Histórico total {fmt.num(perfil.historico_total)} compras · desvio 30d {fmt.usd(perfil.ultimos_30d.desvio, 2)} · {fmt.num(perfil.lojas_conhecidas)} lojas conhecidas · mais comum: {perfil.categoria_mais_comum} · atualizado até {perfil.snapshot_time?.replace("T", " ").slice(0, 16)}</p>
                <details className="inline">
                  <summary>Ver últimas compras ▾</summary>
                  <div className="tabela-rolar" style={{ maxHeight: 200, overflowY: "auto", marginTop: 6 }}>
                    <table><thead><tr><th>Quando</th><th>Loja</th><th>Categoria</th><th className="n">Valor</th></tr></thead>
                      <tbody>{[...(perfil.historico_recente || [])].reverse().slice(0, 12).map((h: any, i: number) => (
                        <tr key={i}><td>{new Date(h.ts * 1000).toISOString().slice(0, 16).replace("T", " ")}</td><td>{h.merchant}</td><td>{h.category}</td><td className="n">{fmt.usd(h.amount, 2)}</td></tr>
                      ))}</tbody></table>
                  </div>
                </details>
              </>
            )}
          </div>

          {!resp && !carregando && (
            <div className="estado" style={{ textAlign: "center", padding: 28 }}>Escolha um cenário ou monte a compra e toque em <b>Pagar</b>. A resposta do modelo, a explicação e a trilha de execução aparecem aqui.</div>
          )}
          {carregando && !resp && <div className="esqueleto" style={{ height: 220 }} aria-label="processando" />}

          {resp && (
            <div className="grade g2 painel" key={resp.transaction_id}>
              <div className="card">
                <div className="card-cab"><h2>Resposta do modelo</h2><Acao a={resp.decision} /></div>
                <div style={{ margin: "14px 0 6px", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-.03em" }} className="mono">{resp.calibrated_score.toFixed(4)}</span>
                  <span className="nota" style={{ margin: 0 }}>score calibrado (probabilidade estimada de fraude)</span>
                </div>
                <div className="medidor" style={{ ["--a" as any]: `${posLog(resp.cortes.t_auth)}%`, ["--r" as any]: `${posLog(resp.cortes.t_review)}%` }} role="img"
                  aria-label={`Score ${resp.calibrated_score.toFixed(4)}; verificação a partir de ${resp.cortes.t_auth.toFixed(4)}; investigação a partir de ${resp.cortes.t_review.toFixed(4)}`}>
                  <span className="agulha" style={{ left: `${posLog(resp.calibrated_score)}%` }} />
                </div>
                <div className="medidor-rot"><span>aprovar</span><span>verificar ≥ {resp.cortes.t_auth.toFixed(4)}</span><span>investigar ≥ {resp.cortes.t_review.toFixed(4)}</span></div>
                <table className="compacta" style={{ marginTop: 12 }}><tbody>
                  <tr><td>Score bruto</td><td className="n mono">{resp.raw_score.toFixed(4)}</td></tr>
                  <tr><td>Modelo</td><td className="n mono" style={{ fontSize: ".75rem" }}>{resp.model_version}</td></tr>
                  <tr><td>Política</td><td className="n mono" style={{ fontSize: ".75rem" }}>{resp.policy_version}</td></tr>
                  <tr><td>Relógio virtual</td><td className="n mono">{resp.event_time.slice(0, 16).replace("T", " ")}</td></tr>
                  <tr><td>Latência</td><td className="n mono">{resp.latency_ms.toFixed(1)} ms</td></tr>
                  <tr><td>Correlação</td><td className="n mono">{resp.transaction_id.slice(0, 16)}…</td></tr>
                  <tr><td>Evento</td><td className="n">{status?.event_status_atual || resp.event_status}</td></tr>
                </tbody></table>
                <p className="nota">Medidor em escala logarítmica. {resp.shadow ? `Modo sombra: ${resp.shadow.modelo} daria score ${resp.shadow.score.toFixed(3)} → ${ROTULO_ACAO[resp.shadow.decisao_hipotetica]} (hipotético, nunca aplicado).` : ""}</p>
              </div>
              <div className="card">
                <div className="card-cab"><h2>Por que esta decisão</h2><span className="selo sem-ponto">SHAP</span></div>
                <p className="nota" style={{ marginTop: 0 }}>Contribuições do modelo bruto em log-odds (não são % de risco). <span style={{ color: "var(--risco)" }}>Barra à direita aumenta o risco</span>; <span style={{ color: "var(--protecao)" }}>à esquerda, reduz</span>. Base: {resp.reasons.base_log_odds}.</p>
                <ul className="shap">
                  {resp.reasons.itens.map((m: any) => {
                    const v = m.contribuicao_log_odds, w = (Math.abs(v) / maxShap) * 50;
                    return (
                      <li key={m.feature}>
                        <span className="nome">{m.rotulo} <small>= {m.valor ?? "sem histórico"}</small></span>
                        <span className="v" style={{ color: v > 0 ? "var(--risco)" : "var(--protecao)" }}>{v > 0 ? "+" : ""}{v.toFixed(2)}</span>
                        <span className="eixo" aria-hidden><span style={{ left: v > 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: v > 0 ? "var(--risco)" : "var(--protecao)" }} /></span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="card" style={{ gridColumn: "1 / -1" }}>
                <div className="card-cab"><div><h2>Trilha de execução</h2><p>Tempos reais medidos no servidor, acumulados desde a chegada da requisição.</p></div>
                  <span className="selo sem-ponto">{resp.modo === "transação" ? "transação com evento" : "what-if sem gravação"}</span></div>
                <ol className="etapas">
                  {resp.trilha.map((t: any, i: number) => (
                    <li key={t.etapa} style={{ animationDelay: `${i * 60}ms` }}><div className="e"><span className="ponto" />{t.etapa}</div><div className="t">{t.ms.toFixed(2)} ms</div></li>
                  ))}
                  {resp.modo === "transação" && (
                    <li style={{ animationDelay: `${resp.trilha.length * 60}ms` }}><div className="e"><span className={`ponto ${status?.persistencia ? "" : "pend"}`} />persistência assíncrona (worker → BigQuery)</div>
                      <div className="t">{status?.persistencia ? `${status.persistencia.atraso_s}s · ${status.persistencia.destino}` : "aguardando…"}</div></li>
                  )}
                </ol>
                <p className="nota">Caminho síncrono até a decisão: {ultimaEtapa.toFixed(1)} ms. {resp.modo === "transação" ? "O evento segue pelo Redis Streams e o worker grava no BigQuery fora do caminho do cliente." : "No what-if nada é publicado nem gravado, e o histórico do cliente não muda."}</p>
              </div>
            </div>
          )}

          {hist.length > 1 && (
            <div className="card">
              <h2>Comparação de cenários (contrafactual, não causal)</h2>
              <p className="nota">Mesmo cliente (a lista zera ao trocar de cartão), variações da compra. Mostra como o score responde; não prova causa.</p>
              <div className="tabela-rolar"><table>
                <thead><tr><th>Modo</th><th>Loja</th><th className="n">Valor</th><th className="n">Hora</th><th>Local</th><th className="n">Score</th><th>Decisão</th></tr></thead>
                <tbody>{hist.map((h, i) => (
                  <tr key={i}><td>{h.modo === "transação" ? "transação" : "what-if"}</td><td>{h.entrada.merchant}</td><td className="n">{fmt.usd(h.entrada.amount_usd, 2)}</td>
                    <td className="n">{h.entrada.hora}h</td><td>{LOCAIS[h.entrada.local]}</td><td className="n mono">{h.calibrated_score.toFixed(4)}</td><td><Acao a={h.decision} /></td></tr>
                ))}</tbody>
              </table></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
