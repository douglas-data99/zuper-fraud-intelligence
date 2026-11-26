"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Acao, Cabecalho } from "@/components/Kpi";
import LogoZ from "@/components/LogoZ";
import { api, fmt, ROTULO_ACAO } from "@/lib/api";
import s from "./simulador.module.css";

type Cartao = { card_key: string; historico_total: number; ultimos_30d: number; categoria_mais_comum: string; ticket_medio_historico: number };
type Cenario = { tipo: string; descricao: string; card_key: string; merchant: string; categoria: string; amount_usd: number; hora: number; local: string; decisao_na_selecao: string };
type Loja = { merchant: string; categoria: string };
type Resp = any;

const VALOR_MAX = 30000; // limite da API (backend/app/main.py)
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
  const [fase, setFase] = useState(0);              // revelação progressiva dos bastidores (0 = antes do pagamento)
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

  // bastidores se revelam em sequência depois de cada resposta (respeita prefers-reduced-motion)
  useEffect(() => {
    if (!resp) { setFase(0); return; }
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduzido) { setFase(5); return; }
    setFase(1);
    const ts = [2, 3, 4, 5].map((f, k) => setTimeout(() => setFase(f), 380 * (k + 1)));
    return () => ts.forEach(clearTimeout);
  }, [resp]);

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
  // medidor linear de 0 a 100% (probabilidade calibrada)
  const posLin = (v: number) => Math.min(100, Math.max(0, v * 100));
  const pctScore = (v: number) => fmt.pct(v, v < 0.01 ? 2 : 1);
  const media30 = perfil?.ultimos_30d?.media;
  const razao = media30 ? Number(form.amount_usd) / media30 : null;
  // mesmas regras da API (amount_usd > 0 e <= 30000; hora inteira de 0 a 23): avisar antes de enviar
  const valorOk = Number(form.amount_usd) > 0 && Number(form.amount_usd) <= VALOR_MAX;
  const horaOk = Number.isInteger(Number(form.hora)) && Number(form.hora) >= 0 && Number(form.hora) <= 23;
  const entradaOk = valorOk && horaOk;
  const TITULO: Record<string, string> = { aprovar: "Pagamento aprovado", autenticar: "Confirme que é você", investigar: "Pagamento em análise" };
  const ICONE: Record<string, string> = { aprovar: "M5 12.5l4.5 4.5L19 7.5", autenticar: "M12 7v6m0 4h.01", investigar: "M12 8v5m-6 7h12a2 2 0 0 0 1.7-3L13.7 5a2 2 0 0 0-3.4 0L4.3 17A2 2 0 0 0 6 20z" };
  const loja = lojas.find((l) => l.merchant === form.merchant);
  const corLimite = resp ? (resp.calibrated_score >= resp.cortes.t_review ? "var(--risco)" : resp.calibrated_score >= resp.cortes.t_auth ? "var(--atencao)" : "var(--protecao)") : undefined;
  const mostra = (f: number) => (fase >= f ? s.revelado : s.oculto);

  return (
    <>
      <Cabecalho eyebrow="Negócio" titulo="Simulador bancário">
        <p>Faça um pagamento no app e acompanhe, ao lado, o que o banco calcula em milissegundos. A decisão vem da API de verdade: histórico lido do Redis, modelo em memória, motor de decisão por custo.</p>
        <div className="meta"><span>Nenhuma transação real</span><span>Dados sintéticos em USD</span></div>
      </Cabecalho>
      {erro && <div className="estado erro" role="alert" style={{ marginBottom: 20 }}>{erro}. Nada foi aprovado por padrão: sem resposta da API, não há decisão.</div>}

      <div className={s.demo}>
        <div className={s.campoCliente}>
          <label htmlFor="card">Cliente da demonstração</label>
          <select id="card" value={card} onChange={(e) => setCard(e.target.value)}>
            {opcoesCartao.map((c) => <option key={c.card_key} value={c.card_key}>{c.card_key.slice(0, 8)}… · {c.ultimos_30d ? `${c.ultimos_30d} compras/30d · ` : ""}{c.categoria_mais_comum}</option>)}
          </select>
        </div>
        {cenarios.length > 0 && (
          <div className={s.cenarios} role="group" aria-label="Cenários reproduzíveis">
            <span className={s.cenRot}>Cenários prontos</span>
            {cenarios.map((c) => (
              <button key={c.tipo} className={s.cenario} onClick={() => aplicarCenario(c)} title={c.descricao}>
                <b>{NOME_CEN[c.tipo]}</b><span>{fmt.usd(c.amount_usd, 2)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={s.palco}>
        {/* ---------------- o app do banco ---------------- */}
        <div className={s.aparelho} aria-label="Aplicativo do banco (simulado)">
          <div className={s.tela}>
            <div className={s.barraStatus}><span>{form.hora.toString().padStart(2, "0")}:00</span><span className={s.notch} aria-hidden /><span>5G</span></div>

            {!resp ? (
              <div className={s.app} key="form">
                <div className={s.appTopo}>
                  <span className={s.appMarca}><LogoZ tamanho={13} /> Zuper Bank</span>
                  <span className={s.appCartao}>•••• {card.slice(-4) || "----"}</span>
                </div>
                <h2 className={s.appTitulo}>Pagar com cartão</h2>

                <label htmlFor="valor" className={s.appRot}>Valor</label>
                <div className={s.valor}>
                  <span>US$</span>
                  <input id="valor" type="number" min={1} max={30000} step="0.01" value={form.amount_usd} onChange={(e) => setForm({ ...form, amount_usd: Number(e.target.value) })} />
                </div>
                {!valorOk ? <p className={s.dicaValor} role="alert" style={{ color: "var(--risco)" }}>{Number(form.amount_usd) > VALOR_MAX ? `O valor máximo desta demonstração é ${fmt.usd(VALOR_MAX)}: a maior compra da base é de ${fmt.usd(28948.9, 2)} e o modelo não foi treinado além disso.` : "Informe um valor maior que zero."}</p>
                  : razao != null && <p className={s.dicaValor}>A média deste cliente nos últimos 30 dias é {fmt.usd(media30, 2)}.</p>}

                <div className={s.lista}>
                  <div className={s.item}>
                    <label htmlFor="loja">Estabelecimento</label>
                    <select id="loja" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })}>
                      {lojasOrdenadas.map((l) => <option key={l.merchant} value={l.merchant}>{perfil?.lojas_sugeridas?.includes(l.merchant) ? "★ " : ""}{l.merchant} · {l.categoria}</option>)}
                    </select>
                  </div>
                  <div className={s.itemDuplo}>
                    <div className={s.item}>
                      <label htmlFor="hora">Horário</label>
                      <input id="hora" type="number" min={0} max={23} aria-invalid={!horaOk} style={horaOk ? undefined : { color: "var(--risco)" }} value={form.hora} onChange={(e) => setForm({ ...form, hora: Number(e.target.value) })} />
                    </div>
                    <div className={s.item}>
                      <label htmlFor="local">Onde fica a loja</label>
                      <select id="local" value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })}>
                        {Object.entries(LOCAIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div className={s.appAcoes}>
                  <button className={`primario ${s.pagar}`} disabled={!card || !form.merchant || carregando || !entradaOk} onClick={() => enviar(true)}>
                    {carregando ? "Processando…" : `Pagar ${fmt.usd(Number(form.amount_usd), 2)}`}
                  </button>
                  <button className={`fantasma ${s.whatif}`} disabled={!card || !form.merchant || carregando || !entradaOk} onClick={() => enviar(false)}>Simular sem gravar (what-if)</button>
                </div>
              </div>
            ) : (
              <div className={`${s.app} ${s.resultado} ${s[resp.decision]}`} key={resp.transaction_id} role="status">
                <div className={s.appTopo}>
                  <span className={s.appMarca}><LogoZ tamanho={13} /> Zuper Bank</span>
                  <span className={s.appCartao}>•••• {card.slice(-4)}</span>
                </div>
                <div className={s.selo}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONE[resp.decision]} /></svg>
                </div>
                <h2 className={s.resTitulo}>{TITULO[resp.decision]}</h2>
                <div className={s.resValor}>{fmt.usd(Number(hist[0]?.entrada?.amount_usd ?? form.amount_usd), 2)}</div>
                <p className={s.resLoja}>{hist[0]?.entrada?.merchant ?? form.merchant}{loja ? ` · ${loja.categoria}` : ""}</p>
                {resp.decision === "autenticar" && (
                  resp.modo === "transação"
                    ? <button className={`primario ${s.pagar}`} onClick={() => setConfirmado(true)} disabled={confirmado}>{confirmado ? "Confirmado (simulação)" : "Sou eu, confirmar (fictício)"}</button>
                    : <p className={s.resNota}>Na compra real, o app pediria uma confirmação aqui.</p>
                )}
                {resp.decision === "investigar" && <p className={s.resNota}>Pagamento retido para análise. Alerta não é prova de fraude: um analista revisa antes de qualquer bloqueio.</p>}
                {resp.decision === "aprovar" && <p className={s.resNota}>Sem nenhuma etapa extra para o cliente.</p>}
                <p className={s.resModo}>{resp.modo === "transação" ? "Transação registrada com evento" : "What-if: nada foi gravado"}</p>
                <button className={`fantasma ${s.whatif}`} onClick={() => setResp(null)}>Nova compra</button>
              </div>
            )}
          </div>
        </div>

        {/* ---------------- bastidores ---------------- */}
        <ol className={s.bastidores} aria-label="O que o banco calcula">
          <li className={s.etapa}>
            <span className={s.marco}>1</span>
            <div className={s.etapaCorpo}>
              <h3>Quem está comprando</h3>
              <p className={s.etapaSub}>Comportamento do cartão, lido da feature store online.</p>
              {!perfil ? (erro ? <div className="estado">Perfil indisponível: a API não respondeu.</div> : <div className="esqueleto" style={{ height: 64 }} aria-label="carregando perfil" />) : (
                <>
                  <dl className={s.perfil}>
                    <div><dt>Compra atual</dt><dd>{fmt.usd(Number(form.amount_usd), 2)}</dd></div>
                    <div><dt>Média 30 dias</dt><dd>{fmt.usd(perfil.ultimos_30d.media, 2)}</dd></div>
                    <div><dt>Compra ÷ média</dt><dd style={{ color: razao == null ? undefined : razao > 5 ? "var(--risco)" : razao > 2 ? "var(--atencao)" : "var(--protecao)" }}>{razao == null ? "sem histórico" : `${fmt.num(razao, 1)}×`}</dd></div>
                    <div><dt>Compras em 30 dias</dt><dd>{fmt.num(perfil.ultimos_30d.transacoes)}</dd></div>
                  </dl>
                  <details className="inline">
                    <summary>Mais do histórico</summary>
                    <p className={s.etapaSub} style={{ marginTop: 10 }}>{fmt.num(perfil.historico_total)} compras no histórico, desvio de {fmt.usd(perfil.ultimos_30d.desvio, 2)} em 30 dias, {fmt.num(perfil.lojas_conhecidas)} lojas conhecidas, categoria mais comum {perfil.categoria_mais_comum}. Atualizado até {perfil.snapshot_time?.replace("T", " ").slice(0, 16)}.</p>
                    <div className="tabela-rolar" style={{ maxHeight: 220, overflowY: "auto" }}>
                      <table><thead><tr><th>Quando</th><th>Loja</th><th>Categoria</th><th className="n">Valor</th></tr></thead>
                        <tbody>{[...(perfil.historico_recente || [])].reverse().slice(0, 12).map((h: any, i: number) => (
                          <tr key={i}><td>{new Date(h.ts * 1000).toISOString().slice(0, 16).replace("T", " ")}</td><td>{h.merchant}</td><td>{h.category}</td><td className="n">{fmt.usd(h.amount, 2)}</td></tr>
                        ))}</tbody></table>
                    </div>
                  </details>
                </>
              )}
            </div>
          </li>

          <li className={`${s.etapa} ${resp ? "" : s.aguardando}`}>
            <span className={s.marco}>2</span>
            <div className={s.etapaCorpo}>
              <h3>Quanto risco o modelo vê</h3>
              {!resp ? (
                carregando ? <div className="esqueleto" style={{ height: 90, marginTop: 12 }} aria-label="processando" />
                  : <p className={s.etapaSub}>Toque em <b>Pagar</b> ou simule sem gravar. A chance de fraude, o motivo e o caminho da decisão aparecem aqui, um de cada vez.</p>
              ) : (
                <div className={mostra(1)} key={resp.transaction_id}>
                  <div className={s.score}>
                    <span className={s.scoreNum}>{pctScore(resp.calibrated_score)}</span>
                    <span className={s.etapaSub}>chance estimada de fraude (score calibrado)</span>
                  </div>
                  <p className={s.limite} style={{ color: corLimite }}>
                    {resp.calibrated_score >= resp.cortes.t_review ? `Acima do limite de investigação (${fmt.pct(resp.cortes.t_review, 1)})`
                      : resp.calibrated_score >= resp.cortes.t_auth ? `Entre os limites de verificação (${fmt.pct(resp.cortes.t_auth, 1)}) e investigação (${fmt.pct(resp.cortes.t_review, 1)})`
                      : `Abaixo do limite de verificação (${fmt.pct(resp.cortes.t_auth, 1)})`}
                    <span className={s.acaoTag}><Acao a={resp.decision} /></span>
                  </p>
                  <div className={s.medidor} style={{ ["--a" as any]: `${posLin(resp.cortes.t_auth)}%`, ["--r" as any]: `${posLin(resp.cortes.t_review)}%` }} role="img"
                    aria-label={`Chance de fraude ${pctScore(resp.calibrated_score)}; verificação a partir de ${fmt.pct(resp.cortes.t_auth, 1)}; investigação a partir de ${fmt.pct(resp.cortes.t_review, 1)}`}>
                    <span className={s.agulha} style={{ left: `${posLin(resp.calibrated_score)}%` }} />
                  </div>
                  <div className={s.escala}><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
                  <div className={s.legenda}>
                    <span><i style={{ background: "var(--protecao)" }} />aprovar &lt; {fmt.pct(resp.cortes.t_auth, 1)}</span>
                    <span><i style={{ background: "var(--atencao)" }} />verificar ≥ {fmt.pct(resp.cortes.t_auth, 1)}</span>
                    <span><i style={{ background: "var(--risco)" }} />investigar ≥ {fmt.pct(resp.cortes.t_review, 1)}</span>
                  </div>
                  <dl className={s.ficha}>
                    <div><dt>Score bruto (antes da calibração)</dt><dd className="mono">{resp.raw_score.toFixed(4)}</dd></div>
                    <div><dt>Modelo</dt><dd className="mono">{resp.model_version}</dd></div>
                    <div><dt>Política</dt><dd className="mono">{resp.policy_version}</dd></div>
                    <div><dt>Relógio virtual</dt><dd className="mono">{resp.event_time.slice(0, 16).replace("T", " ")}</dd></div>
                    <div><dt>Latência</dt><dd className="mono">{resp.latency_ms.toFixed(1)} ms</dd></div>
                    <div><dt>Correlação</dt><dd className="mono">{resp.transaction_id.slice(0, 16)}…</dd></div>
                    <div><dt>Evento</dt><dd>{status?.event_status_atual || resp.event_status}</dd></div>
                  </dl>
                </div>
              )}
            </div>
          </li>

          <li className={`${s.etapa} ${resp && fase >= 2 ? "" : s.aguardando}`}>
            <span className={s.marco}>3</span>
            <div className={s.etapaCorpo}>
              <h3>Por que esta decisão</h3>
              {resp && fase >= 2 && (
                <div className={s.revelado}>
                  <p className={s.etapaSub}>Contribuições SHAP do modelo bruto, em log-odds (não são % de risco). <span style={{ color: "var(--risco)" }}>À direita, aumenta o risco</span>; <span style={{ color: "var(--protecao)" }}>à esquerda, reduz</span>. Base: {resp.reasons.base_log_odds}.</p>
                  <ul className={s.shap}>
                    {resp.reasons.itens.map((m: any, k: number) => {
                      const v = m.contribuicao_log_odds, w = (Math.abs(v) / maxShap) * 50;
                      return (
                        <li key={m.feature} style={{ animationDelay: `${k * 50}ms` }}>
                          <span className={s.shapNome}>{m.rotulo} <small>= {m.valor ?? "sem histórico"}</small></span>
                          <span className={s.shapV} style={{ color: v > 0 ? "var(--risco)" : "var(--protecao)" }}>{v > 0 ? "+" : ""}{v.toFixed(2)}</span>
                          <span className={s.eixo} aria-hidden><span style={{ left: v > 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: v > 0 ? "var(--risco)" : "var(--protecao)" }} /></span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </li>

          <li className={`${s.etapa} ${resp && fase >= 3 ? "" : s.aguardando}`}>
            <span className={s.marco}>4</span>
            <div className={s.etapaCorpo}>
              <h3>Caminho da decisão</h3>
              {resp && fase >= 3 && (
                <div className={s.revelado}>
                  <p className={s.etapaSub}>Tempos reais medidos no servidor, acumulados desde a chegada da requisição.</p>
                  <ol className={s.trilha}>
                    {resp.trilha.map((t: any, i: number) => (
                      <li key={t.etapa} style={{ animationDelay: `${i * 60}ms` }}><span className={s.ponto} />{t.etapa}<span className="mono">{t.ms.toFixed(2)} ms</span></li>
                    ))}
                    {resp.modo === "transação" && (
                      <li style={{ animationDelay: `${resp.trilha.length * 60}ms` }}>
                        <span className={`${s.ponto} ${status?.persistencia ? "" : s.pendente}`} />persistência assíncrona (worker → BigQuery)
                        <span className="mono">{status?.persistencia ? `${status.persistencia.atraso_s}s · ${status.persistencia.destino}` : "aguardando…"}</span>
                      </li>
                    )}
                  </ol>
                  <p className={s.etapaSub}>Caminho síncrono até a decisão: {ultimaEtapa.toFixed(1)} ms. {resp.modo === "transação" ? "O evento segue pelo Redis Streams e o worker grava no BigQuery fora do caminho do cliente." : "No what-if nada é publicado nem gravado, e o histórico do cliente não muda."}</p>
                </div>
              )}
            </div>
          </li>

          <li className={`${s.etapa} ${resp && fase >= 4 ? "" : s.aguardando}`}>
            <span className={s.marco}>5</span>
            <div className={s.etapaCorpo}>
              <h3>Segunda opinião</h3>
              {resp && fase >= 4 && (
                <div className={s.revelado}>
                  {resp.shadow
                    ? <p className={s.etapaSub}>Challenger (em observação, não decide): recomendaria {ROTULO_ACAO[resp.shadow.decisao_hipotetica]?.toLowerCase()} · score próprio {resp.shadow.score.toFixed(3)}, sem calibração.</p>
                    : <p className={s.etapaSub}>Challenger desligado nesta resposta.</p>}
                </div>
              )}
            </div>
          </li>
        </ol>
      </div>

      {hist.length > 1 && (
        <details className="recolhe" style={{ marginTop: 40 }}>
          <summary><span>Comparação de cenários <small>contrafactual, não causal · {hist.length} respostas deste cliente</small></span><span className="chev" aria-hidden>▾</span></summary>
          <div className="corpo">
            <p className="nota" style={{ marginTop: 0 }}>Mesmo cliente (a lista zera ao trocar de cartão), variações da compra. Mostra como o score responde; não prova causa.</p>
            <div className="tabela-rolar"><table>
              <thead><tr><th>Modo</th><th>Loja</th><th className="n">Valor</th><th className="n">Hora</th><th>Local</th><th className="n">Score</th><th>Decisão</th></tr></thead>
              <tbody>{hist.map((h, i) => (
                <tr key={i}><td>{h.modo === "transação" ? "transação" : "what-if"}</td><td>{h.entrada.merchant}</td><td className="n">{fmt.usd(h.entrada.amount_usd, 2)}</td>
                  <td className="n">{h.entrada.hora}h</td><td>{LOCAIS[h.entrada.local]}</td><td className="n mono">{h.calibrated_score.toFixed(4)}</td><td><Acao a={h.decision} /></td></tr>
              ))}</tbody>
            </table></div>
          </div>
        </details>
      )}
    </>
  );
}
