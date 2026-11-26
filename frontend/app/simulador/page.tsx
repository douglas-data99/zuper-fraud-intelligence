"use client";
import { useEffect, useMemo, useState } from "react";
import { Acao } from "@/components/Kpi";
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

  useEffect(() => {
    Promise.all([api<Cartao[]>("/profiles?limite=60"), api<Cenario[]>("/scenarios"), api<Loja[]>("/merchants")])
      .then(([c, s, l]) => { setCartoes(c); setCenarios(s); setLojas(l); if (c[0]) setCard(c[0].card_key); })
      .catch((e) => setErro(e.message));
  }, []);

  useEffect(() => {
    if (!card) return;
    setPerfil(null);
    api<any>(`/profiles/${card}`).then((p) => {
      setPerfil(p);
      setForm((f) => ({ ...f, merchant: p.lojas_sugeridas?.[0] || f.merchant, amount_usd: Math.round((p.ultimos_30d.media || 50) * 100) / 100 }));
    }).catch((e) => setErro(e.message));
  }, [card]);

  const lojasOrdenadas = useMemo(() => {
    const sug = new Set(perfil?.lojas_sugeridas || []);
    return [...lojas].sort((a, b) => Number(sug.has(b.merchant)) - Number(sug.has(a.merchant)) || a.categoria.localeCompare(b.categoria));
  }, [lojas, perfil]);

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
          if (card) api<any>(`/profiles/${card}`).then(setPerfil).catch(() => {});
        }
      } catch { if (n > 20) clearInterval(t); }
    }, 1500);
  }

  function aplicarCenario(c: Cenario) {
    setCard(c.card_key);
    setTimeout(() => setForm({ merchant: c.merchant, amount_usd: c.amount_usd, hora: c.hora, local: c.local }), 400);
  }

  return (
    <>
      <span className="aviso">Simulação · nenhuma transação real · resposta calculada pela API em tempo real</span>
      <div className="cabeca">
        <div>
          <h1>Simulador de pagamento</h1>
          <p>Escolha um cartão, monte a compra e veja o score <b>calculado de verdade</b> pela API, com o histórico do cliente lido do Redis (o navegador não envia histórico).</p>
        </div>
      </div>
      {erro && <div className="estado erro" role="alert">{erro}</div>}

      {cenarios.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3>Cenários reproduzíveis</h3>
          <div className="grade g3">
            {cenarios.map((c) => (
              <button key={c.tipo} onClick={() => aplicarCenario(c)} style={{ textAlign: "left" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>{NOME_CEN[c.tipo]}</span><span className="selo">{fmt.usd(c.amount_usd, 2)}</span></div>
                <div className="nota" style={{ marginTop: 4 }}>{c.descricao}</div>
              </button>
            ))}
          </div>
          <p className="nota">Selecionados por what-if real sobre o snapshot. O resultado exibido é sempre o que a API devolve agora; nada é forçado.</p>
        </div>
      )}

      <div className="sim">
        <div className="celular" aria-label="Celular simulado">
          <div className="tela">
            <div className="topo"><span>Zuper Bank (fictício)</span><span>{form.hora.toString().padStart(2, "0")}:00</span></div>
            <div className="cartao-visual">
              <div style={{ opacity: .8 }}>cartão pseudonimizado</div>
              <div style={{ fontSize: "1rem", marginTop: 8 }}>•••• {card.slice(-4)}</div>
            </div>
            <div>
              <label htmlFor="card">Cliente / cartão</label>
              <select id="card" value={card} onChange={(e) => setCard(e.target.value)}>
                {cartoes.map((c) => <option key={c.card_key} value={c.card_key}>{c.card_key.slice(0, 8)}… · {c.ultimos_30d} compras/30d · {c.categoria_mais_comum}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="loja">Estabelecimento</label>
              <select id="loja" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })}>
                {lojasOrdenadas.map((l) => <option key={l.merchant} value={l.merchant}>{perfil?.lojas_sugeridas?.includes(l.merchant) ? "★ " : ""}{l.merchant} · {l.categoria}</option>)}
              </select>
            </div>
            <div className="grade g2">
              <div><label htmlFor="valor">Valor (USD)</label><input id="valor" type="number" min={1} max={30000} step="0.01" value={form.amount_usd} onChange={(e) => setForm({ ...form, amount_usd: Number(e.target.value) })} /></div>
              <div><label htmlFor="hora">Hora</label><input id="hora" type="number" min={0} max={23} value={form.hora} onChange={(e) => setForm({ ...form, hora: Number(e.target.value) })} /></div>
            </div>
            <div>
              <label htmlFor="local">Onde está a loja</label>
              <select id="local" value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })}>
                {Object.entries(LOCAIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <button className="primario" disabled={!card || !form.merchant || carregando} onClick={() => enviar(true)}>{carregando ? "Processando…" : "Efetuar pagamento"}</button>
            <button disabled={!card || !form.merchant || carregando} onClick={() => enviar(false)}>Simular sem gravar (what-if)</button>
            {resp && (
              <div className="card" style={{ background: "#0d131c" }}>
                <Acao a={resp.decision} />
                <div className="nota">{resp.modo}</div>
                {resp.decision === "autenticar" && resp.modo === "transacao" && (
                  <button style={{ marginTop: 8, width: "100%" }} onClick={() => setConfirmado(true)} disabled={confirmado}>
                    {confirmado ? "Confirmado (simulação)" : "Confirmar no app (confirmação fictícia)"}
                  </button>
                )}
                {resp.decision === "investigar" && <p className="nota">Pagamento retido para análise. Alerta não é prova de fraude.</p>}
              </div>
            )}
          </div>
        </div>

        <div className="grade" style={{ gap: 14 }}>
          <div className="card">
            <h2>Histórico do cliente <span className="selo">lido do Redis</span></h2>
            {!perfil ? <div className="estado">carregando perfil…</div> : (
              <>
                <div className="grade g4">
                  <div><div className="nota">Compras no histórico</div><b>{fmt.num(perfil.historico_total)}</b></div>
                  <div><div className="nota">Média 30 dias</div><b>{fmt.usd(perfil.ultimos_30d.media, 2)}</b></div>
                  <div><div className="nota">Desvio 30 dias</div><b>{fmt.usd(perfil.ultimos_30d.desvio, 2)}</b></div>
                  <div><div className="nota">Lojas conhecidas</div><b>{fmt.num(perfil.lojas_conhecidas)}</b></div>
                </div>
                <p className="nota">Atualizado até {perfil.snapshot_time?.replace("T", " ").slice(0, 16)} · {perfil.ultimos_30d.transacoes} compras nos últimos 30 dias · mais comum: {perfil.categoria_mais_comum}</p>
                <div className="tabela-rolar" style={{ maxHeight: 190, overflowY: "auto" }}>
                  <table><thead><tr><th>Quando</th><th>Loja</th><th>Categoria</th><th className="n">Valor</th></tr></thead>
                    <tbody>{[...(perfil.historico_recente || [])].reverse().slice(0, 12).map((h: any, i: number) => (
                      <tr key={i}><td>{new Date(h.ts * 1000).toISOString().slice(0, 16).replace("T", " ")}</td><td>{h.merchant}</td><td>{h.category}</td><td className="n">{fmt.usd(h.amount, 2)}</td></tr>
                    ))}</tbody></table>
                </div>
              </>
            )}
          </div>

          {resp && (
            <div className="grade g2">
              <div className="card">
                <h2>Resposta da API</h2>
                <table><tbody>
                  <tr><td>Decisão</td><td className="n"><Acao a={resp.decision} /></td></tr>
                  <tr><td>Score calibrado</td><td className="n mono">{resp.calibrated_score.toFixed(4)}</td></tr>
                  <tr><td>Score bruto do modelo</td><td className="n mono">{resp.raw_score.toFixed(4)}</td></tr>
                  <tr><td>Cortes da política</td><td className="n mono">{resp.cortes.t_auth.toFixed(4)} / {resp.cortes.t_review.toFixed(4)}</td></tr>
                  <tr><td>Versão do modelo / política</td><td className="n mono">{resp.model_version} · {resp.policy_version}</td></tr>
                  <tr><td>Horário do evento (relógio virtual)</td><td className="n mono">{resp.event_time.slice(0, 16).replace("T", " ")}</td></tr>
                  <tr><td>Latência medida no servidor</td><td className="n mono">{resp.latency_ms.toFixed(1)} ms</td></tr>
                  <tr><td>ID de correlação</td><td className="n mono">{resp.transaction_id.slice(0, 16)}…</td></tr>
                  <tr><td>Status do evento</td><td className="n">{status?.event_status_atual || resp.event_status}</td></tr>
                </tbody></table>
                {resp.shadow && <p className="nota">Modo sombra: {resp.shadow.modelo} daria score {resp.shadow.score.toFixed(3)} → {ROTULO_ACAO[resp.shadow.decisao_hipotetica]} (hipotético, nunca aplicado).</p>}
              </div>
              <div className="card">
                <h2>Por que esta decisão</h2>
                <p className="nota">Contribuições SHAP do modelo bruto, em log-odds (não são % de risco). Base: {resp.reasons.base_log_odds}.</p>
                <ul className="lista-motivos">
                  {resp.reasons.itens.map((m: any) => (
                    <li key={m.feature}>
                      <span>{m.rotulo} <span className="mono" style={{ color: "var(--ink-3)" }}>= {m.valor ?? "sem histórico"}</span></span>
                      <span className="mono" style={{ color: m.contribuicao_log_odds > 0 ? "var(--bad)" : "var(--ok)" }}>{m.contribuicao_log_odds > 0 ? "+" : ""}{m.contribuicao_log_odds.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                <h3 style={{ marginTop: 14 }}>Trilha de processamento (tempos reais)</h3>
                <ul className="trilha">
                  {resp.trilha.map((t: any) => <li key={t.etapa}><span className="ponto" /><span>{t.etapa}</span><span className="mono">{t.ms.toFixed(2)} ms</span></li>)}
                  {resp.modo === "transacao" && (
                    <li><span className={`ponto ${status?.persistencia ? "" : "pend"}`} /><span>persistência (worker → BigQuery)</span>
                      <span className="mono">{status?.persistencia ? `${status.persistencia.atraso_s}s · ${status.persistencia.destino}` : "pendente…"}</span></li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {hist.length > 1 && (
            <div className="card">
              <h2>Comparação de cenários (contrafactual, não causal)</h2>
              <p className="nota">Mesmo cliente, variações da compra. Mostra como o score responde; não prova causa.</p>
              <div className="tabela-rolar"><table>
                <thead><tr><th>Modo</th><th>Loja</th><th className="n">Valor</th><th className="n">Hora</th><th>Local</th><th className="n">Score</th><th>Decisão</th></tr></thead>
                <tbody>{hist.map((h, i) => (
                  <tr key={i}><td>{h.modo === "transacao" ? "transação" : "what-if"}</td><td>{h.entrada.merchant}</td><td className="n">{fmt.usd(h.entrada.amount_usd, 2)}</td>
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
