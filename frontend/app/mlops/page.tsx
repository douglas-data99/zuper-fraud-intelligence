"use client";
import { useEffect, useState } from "react";
import { api, dado, fmt } from "@/lib/api";

function Ponto({ ok }: { ok: boolean | null }) {
  const cor = ok == null ? "var(--ink-3)" : ok ? "var(--ok)" : "var(--bad)";
  return <span aria-label={ok == null ? "desconhecido" : ok ? "ok" : "falha"} style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: cor, marginRight: 6 }} />;
}

function Caixa({ titulo, sub, ok, extra }: { titulo: string; sub: string; ok: boolean | null; extra?: string }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <b style={{ fontSize: ".9rem" }}><Ponto ok={ok} />{titulo}</b>
      <div className="nota" style={{ marginTop: 2 }}>{sub}</div>
      {extra && <div className="mono" style={{ fontSize: ".78rem", marginTop: 4, color: "var(--ink-2)" }}>{extra}</div>}
    </div>
  );
}

export default function Mlops() {
  const [st, setSt] = useState<any>(null);
  const [mod, setMod] = useState<any>(null);
  const [met, setMet] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [testes, setTestes] = useState<any>(null);
  const [carga, setCarga] = useState<any>(null);

  useEffect(() => {
    const ler = () => Promise.all([api<any>("/architecture/status"), api<any>("/models"), api<any>("/metrics")])
      .then(([a, b, c]) => { setSt(a); setMod(b); setMet(c); setErro(null); }).catch((e) => setErro(e.message));
    ler();
    const t = setInterval(ler, 8000);
    dado<any>("teste_pytest.json").then(setTestes).catch(() => setTestes(null));
    dado<any>("carga.json").then(setCarga).catch(() => setCarga(null));
    return () => clearInterval(t);
  }, []);

  const mon = met?.monitoramento;
  const perf = mon?.desempenho_safra_madura;

  return (
    <>
      <span className="aviso">Estado real dos serviços, lido da API a cada 8 s · o que não está implementado aparece como roadmap</span>
      <div className="cabeca"><div>
        <h1>Engenharia e MLOps</h1>
        <p>Caminho síncrono sem BigQuery: perfil no Redis, modelo em memória, decisão em milissegundos. O histórico analítico, as features de treino e a trilha de auditoria ficam no BigQuery.</p>
      </div></div>
      {erro && <div className="estado erro">{erro}</div>}

      <div className="card">
        <h2>Arquitetura (estado ao vivo)</h2>
        <div className="grade g4" style={{ alignItems: "stretch" }}>
          <Caixa titulo="Next.js (Vercel)" sub="interface, 5 páginas" ok={true} />
          <Caixa titulo="FastAPI" sub="validação, features, inferência, decisão" ok={st ? st.api?.status === "ok" : null} extra={st?.api?.modelo_carregado} />
          <Caixa titulo="Redis (feature store online)" sub="perfis e lojas, lookup O(1)" ok={st ? st.redis?.status === "ok" : null} extra={st?.redis?.perfis ? `${st.redis.perfis} perfis` : undefined} />
          <Caixa titulo="Redis Streams" sub="eventos de transação e decisão" ok={st ? st.stream != null : null} extra={st?.stream ? `${fmt.num(st.stream.tamanho)} eventos · ${st.stream.pendentes_sem_ack ?? 0} sem ACK · lag ${st.stream.lag ?? 0}` : undefined} />
          <Caixa titulo="Worker Python" sub="atualiza histórico, persiste com ACK" ok={st ? st.worker?.status === "ok" : null} extra={st?.worker?.ultimo_sinal_s != null ? `último sinal há ${st.worker.ultimo_sinal_s}s` : "sem sinal"} />
          <Caixa titulo="BigQuery" sub="Bronze → Silver → Gold, auditoria" ok={st ? st.bigquery?.status === "ok" : null} extra={st?.bigquery?.quando ? `última carga: ${st.bigquery.linhas} linhas, ${new Date(st.bigquery.quando * 1000).toLocaleTimeString("pt-BR")}` : st?.bigquery?.status} />
          <Caixa titulo="MLflow (privado)" sub="tracking + registry, só por túnel SSH" ok={null} extra="aliases: champion / challenger" />
          <Caixa titulo="Replay (relógio virtual)" sub="período de teste reapresentado" ok={st ? st.replay?.status === "rodando" : null} extra={st?.replay ? `${st.replay.status} · ${fmt.num(st.replay.cursor)}/${fmt.num(st.replay.total)}` : undefined} />
        </div>
      </div>

      <div className="secao grade g2">
        <div className="card">
          <h2>Modelos em produção (simulada)</h2>
          {mod ? <table><tbody>
            <tr><td>Champion</td><td className="n">{mod.champion.nome}</td></tr>
            <tr><td>Versão</td><td className="n mono">{mod.champion.versao}</td></tr>
            <tr><td>Calibração</td><td className="n">{mod.champion.calibracao}</td></tr>
            <tr><td>Dataset (sha256)</td><td className="n mono">{mod.champion.dataset_sha256?.slice(0, 12)}…</td></tr>
            <tr><td>Challenger</td><td className="n">{mod.challenger.nome} · {mod.challenger.modo}</td></tr>
            <tr><td>Política</td><td className="n mono">{mod.politica.versao} · {mod.politica.t_auth.toFixed(4)} / {mod.politica.t_review.toFixed(4)}</td></tr>
          </tbody></table> : <div className="estado">N/D</div>}
          <p className="nota">Promoção é manual e explícita (alias no MLflow Registry), nunca automática por uma métrica subir.</p>
        </div>
        <div className="card">
          <h2>Monitoramento do replay <span className="selo replay">relógio virtual</span></h2>
          {!mon ? <div className="estado">Replay ainda sem janela suficiente.</div> : (
            <>
              <p className="nota">Relógio virtual: {mon.relogio_virtual?.slice(0, 16).replace("T", " ")} · {fmt.num(mon.eventos_processados)} eventos {mon.deriva_simulada_valor !== 1 && <b style={{ color: "var(--warn)" }}>· deriva simulada ×{mon.deriva_simulada_valor}</b>}</p>
              <table><thead><tr><th>Sinal (PSI vs janela policy)</th><th className="n">PSI</th><th>Leitura</th></tr></thead>
                <tbody>{Object.entries<any>(mon.psi).map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td className="n mono">{v == null ? "N/D" : v.toFixed(3)}</td>
                    <td>{v == null ? "amostra pequena" : v < 0.1 ? "estável" : v < 0.25 ? "atenção" : "investigar"}</td></tr>
                ))}</tbody></table>
              <p className="nota">{mon.psi_regra}</p>
            </>
          )}
        </div>
      </div>

      <div className="secao grade g2">
        <div className="card">
          <h2>Rótulos atrasados e safra madura</h2>
          {!mon ? <div className="estado">N/D</div> : (
            <>
              <div className="grade g3">
                <div><div className="nota">Rótulos maduros</div><b>{fmt.num(mon.rotulos.maduros)}</b></div>
                <div><div className="nota">Aguardando 30 dias</div><b>{fmt.num(mon.rotulos.pendentes)}</b></div>
                <div><div className="nota">Cobertura</div><b>{fmt.pct(mon.rotulos.cobertura)}</b></div>
              </div>
              {perf ? <table style={{ marginTop: 10 }}><tbody>
                <tr><td>Recall (safra madura)</td><td className="n">{fmt.pct(perf.recall)}</td></tr>
                <tr><td>Precisão do alerta</td><td className="n">{fmt.pct(perf.precisao)}</td></tr>
                <tr><td>Recall em valor</td><td className="n">{fmt.pct(perf.recall_valor)}</td></tr>
                <tr><td>Challenger (hipotético, shadow)</td><td className="n">{fmt.pct(perf.challenger_recall_hipotetico)}</td></tr>
              </tbody></table> : <p className="nota">Nenhuma safra madura ainda: recall não é publicado antes da confirmação.</p>}
            </>
          )}
        </div>
        <div className="card">
          <h2>Latência medida (servidor)</h2>
          {met ? <table><thead><tr><th>Origem</th><th className="n">p50</th><th className="n">p95</th><th className="n">p99</th><th className="n">n</th></tr></thead>
            <tbody>{Object.entries<any>(met.latencia_ms).map(([k, v]) => (
              <tr key={k}><td>{k}</td><td className="n mono">{v.p50 ?? "N/D"}</td><td className="n mono">{v.p95 ?? "N/D"}</td><td className="n mono">{v.p99 ?? "N/D"}</td><td className="n">{v.n}</td></tr>
            ))}</tbody></table> : <div className="estado">N/D</div>}
          {carga && <p className="nota">Teste de carga ({carga.data}): {carga.requisicoes} requisições, {carga.concorrencia} simultâneas, p50 {carga.p50_ms} ms, p95 {carga.p95_ms} ms, p99 {carga.p99_ms} ms ponta a ponta, {carga.rps} req/s, erros {fmt.pct(carga.taxa_erro, 2)}. {carga.condicoes}</p>}
        </div>
      </div>

      <div className="secao grade g2">
        <div className="card">
          <h2>Evidências: testes automatizados</h2>
          {testes ? <>
            <p><b>{testes.passaram}</b> passaram, <b>{testes.falharam}</b> falharam, <b>{testes.pulados}</b> pulados · {testes.data} · Python {testes.python} · exit code {testes.exit_code}</p>
            <div className="tabela-rolar" style={{ maxHeight: 260, overflowY: "auto" }}><table><tbody>
              {testes.casos.map((t: any) => <tr key={t.nome}><td className="mono" style={{ fontSize: ".78rem" }}>{t.nome}</td><td className="n">{t.resultado}</td></tr>)}
            </tbody></table></div>
          </> : <div className="estado">Relatório de testes ainda não gerado.</div>}
        </div>
        <div className="card">
          <h2>MLflow: experimentos e registry</h2>
          <p className="nota">Prints reais do MLflow privado (acesso só por túnel SSH).</p>
          <div className="grade" style={{ gap: 8 }}>
            <img src="/prints/mlflow-experimentos.png" alt="Lista de experimentos no MLflow" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }} />
            <img src="/prints/mlflow-registry.png" alt="Model Registry com aliases champion e challenger" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }} />
          </div>
        </div>
      </div>

      <div className="secao card">
        <h2>Roadmap (não implementado)</h2>
        <ul>
          <li>Kafka + Spark/Flink no lugar de Redis Streams + worker quando o volume exigir partições e reprocessamento distribuído.</li>
          <li>A/B e canary com aleatorização por cliente, guardrails de atrito e rollback automático por SLO.</li>
          <li>Retreino agendado só com safra madura e aprovação humana; hoje o retreino é manual e reprodutível (`make train`).</li>
          <li>Features de dispositivo, rede e grafo (contas que compartilham dispositivo), inexistentes nesta base.</li>
        </ul>
      </div>
    </>
  );
}
