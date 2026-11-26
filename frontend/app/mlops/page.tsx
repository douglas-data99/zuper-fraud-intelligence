"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Cabecalho } from "@/components/Kpi";
import { api, dado, fmt } from "@/lib/api";
import s from "./mlops.module.css";

type Estado = boolean | null;

function Status({ ok, rotulo }: { ok: Estado; rotulo?: string }) {
  const cls = ok == null ? s.semLeitura : ok ? s.ok : s.falhou;
  const txt = rotulo ?? (ok == null ? "sem leitura" : ok ? "ok" : "falha");
  return <span className={`${s.estado} ${cls}`}><i aria-hidden />{txt}</span>;
}

function Servico({ logo, nome, papel, ok, medida, rotuloEstado }: { logo: string; nome: string; papel: string; ok: Estado; medida?: string; rotuloEstado?: string }) {
  return (
    <div className={`${s.servico} ${ok === false ? s.falha : ""}`}>
      <img src={logo} alt="" />
      <div className={s.cabServico}><span className={s.nome}>{nome}</span><Status ok={ok} rotulo={rotuloEstado} /></div>
      <span className={s.papel}>{papel}</span>
      <span className={s.medida} title={medida}>{medida ?? "N/D"}</span>
    </div>
  );
}

const Liga = () => <span className={s.liga} aria-hidden />;

function leituraPsi(v: number | null) {
  if (v == null) return { t: "amostra pequena", c: "" };
  if (v < 0.1) return { t: "estável", c: s.estavel };
  if (v < 0.25) return { t: "atenção", c: s.atencaoL };
  return { t: "investigar", c: s.investigar };
}

export default function Mlops() {
  const [st, setSt] = useState<any>(null);
  const [mod, setMod] = useState<any>(null);
  const [met, setMet] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lido, setLido] = useState<Date | null>(null);
  const [testes, setTestes] = useState<any>(null);
  const [carga, setCarga] = useState<any>(null);

  useEffect(() => {
    const ler = () => Promise.all([api<any>("/architecture/status"), api<any>("/models"), api<any>("/metrics")])
      .then(([a, b, c]) => { setSt(a); setMod(b); setMet(c); setErro(null); setLido(new Date()); }).catch((e) => setErro(e.message));
    ler();
    const t = setInterval(ler, 8000);
    dado<any>("teste_pytest.json").then(setTestes).catch(() => setTestes(null));
    dado<any>("carga.json").then(setCarga).catch(() => setCarga(null));
    return () => clearInterval(t);
  }, []);

  const mon = met?.monitoramento;
  const perf = mon?.desempenho_safra_madura;
  const lat = met?.latencia_ms;

  return (
    <>
      <Cabecalho eyebrow="Tecnologia" titulo="Engenharia e MLOps"
        direita={<span className="selo vivo">ao vivo, lido a cada 8 s</span>}>
        <p>Caminho síncrono sem BigQuery: perfil no Redis, modelo em memória, decisão em milissegundos. O histórico analítico, as features de treino e a trilha de auditoria ficam no BigQuery.</p>
        <div className="meta">
          <span className={s.atualizado}>{lido ? `Última leitura da API às ${lido.toLocaleTimeString("pt-BR")}` : "Lendo a API…"}</span>
        </div>
      </Cabecalho>
      {erro && <div className="estado erro" role="alert">{erro}. Os estados abaixo ficam como “sem leitura” até a API responder; nada é presumido como ok.</div>}

      <section className="bloco primeiro">
        <div className="lado">
          <h2>Topologia em produção</h2>
          <p>Cada serviço com o estado informado pela própria API. O cliente só espera pela esteira de cima; a de baixo roda depois, fora do caminho dele.</p>
        </div>
        <div className="corpo">
          <div className={s.esteira}>
            <div className={s.esteiraRot}><b>Caminho síncrono</b><small>o que o cliente espera</small></div>
            <div className={s.cadeia}>
              <Servico logo="/logos/nextjs.svg" nome="Next.js" papel="interface na Vercel" ok={true} rotuloEstado="no ar" medida="6 páginas e a tela inicial" />
              <Liga />
              <Servico logo="/logos/fastapi.svg" nome="FastAPI" papel="validação, features, inferência" ok={st ? st.api?.status === "ok" : null} medida={st?.api?.modelo_carregado} />
              <Liga />
              <Servico logo="/logos/redis.svg" nome="Redis" papel="feature store online" ok={st ? st.redis?.status === "ok" : null} medida={st?.redis?.perfis ? `${fmt.num(st.redis.perfis)} perfis em memória` : undefined} />
            </div>
          </div>
          <div className={s.esteira}>
            <div className={s.esteiraRot}><b>Caminho assíncrono</b><small>eventos, persistência e replay</small></div>
            <div className={s.cadeia}>
              <Servico logo="/logos/python.svg" nome="Replay" papel="relógio virtual" ok={st ? st.replay?.status === "rodando" : null} rotuloEstado={st?.replay?.status}
                medida={st?.replay ? `${fmt.num(st.replay.cursor)} de ${fmt.num(st.replay.total)}` : undefined} />
              <Liga />
              <Servico logo="/logos/redis.svg" nome="Redis Streams" papel="fila de eventos" ok={st ? st.stream?.pendentes_sem_ack != null : null}
                medida={st?.stream ? `${fmt.num(st.stream.tamanho)} no stream, ${st.stream.pendentes_sem_ack ?? "N/D"} sem ACK, lag ${st.stream.lag ?? "N/D"}` : undefined} />
              <Liga />
              <Servico logo="/logos/python.svg" nome="Worker" papel="persiste com ACK" ok={st ? st.worker?.status === "ok" : null}
                medida={st?.worker?.ultimo_sinal_s != null ? `último sinal há ${st.worker.ultimo_sinal_s} s` : "sem sinal"} />
              <Liga />
              <Servico logo="/logos/bigquery.png" nome="BigQuery" papel="Bronze, Silver, Gold" ok={st ? st.bigquery?.status === "ok" : null}
                medida={st?.bigquery?.quando ? `última carga: ${st.bigquery.linhas} linhas às ${new Date(st.bigquery.quando * 1000).toLocaleTimeString("pt-BR")}` : st?.bigquery?.status} />
            </div>
          </div>
          <p className="nota">A API e o replay publicam no mesmo stream. O MLflow é privado (acesso por túnel SSH) e não aparece aqui com estado ao vivo.</p>
        </div>
      </section>

      <section className="bloco">
        <div className="lado">
          <h2>Ciclo de vida do modelo</h2>
          <p>Do dado bruto à revisão. O treino roda fora do caminho do cliente e a promoção de versão é sempre manual.</p>
        </div>
        <div className="corpo">
          <ol className={s.ciclo}>
            <li><div className={s.logos}><img src="/logos/bigquery.png" alt="BigQuery" /><img src="/logos/python.svg" alt="Python" /></div>
              <h3>Preparação dos dados</h3><p>Bronze, Silver e Gold no BigQuery, com features point-in-time.</p></li>
            <li><div className={s.logos}><img src="/logos/xgboost.png" alt="XGBoost" /><img src="/logos/scikitlearn.svg" alt="scikit-learn" /></div>
              <h3>Treino e validação</h3><p>Janelas de tempo separadas para treino, tuning, calibração, política e teste.</p></li>
            <li><div className={s.logos}><img src="/logos/mlflow.png" alt="MLflow" /></div>
              <h3>Registro</h3><p>Parâmetros, métricas, artefatos e versões no MLflow, com aliases.</p></li>
            <li><div className={s.logos}><img src="/logos/docker.svg" alt="Docker" /><img src="/logos/fastapi.svg" alt="FastAPI" /></div>
              <h3>Disponibilização</h3><p>Bundle congelado na API; o challenger roda em sombra, sem decidir.</p></li>
            <li><div className={s.logos}><img src="/logos/python.svg" alt="Python" /></div>
              <h3>Monitoramento</h3><p>Latência, PSI e safra madura com rótulo em D+30.</p></li>
            <li><div className={s.logos} />
              <h3>Revisão</h3><p>Ajuste de cortes ou retreino, com aprovação humana.</p></li>
          </ol>
          <p className={s.retorno}>A revisão volta para a preparação dos dados: um retreino só usa safra madura e passa de novo por todas as janelas de validação.</p>

          <h3 className={s.subtitulo} style={{ marginTop: 28 }}>Modelos em serviço</h3>
          {mod ? <table><tbody>
            <tr><td>Champion</td><td className="n">{mod.champion.nome}</td></tr>
            <tr><td>Versão</td><td className="n mono">{mod.champion.versao}</td></tr>
            <tr><td>Calibração</td><td className="n">{mod.champion.calibracao}</td></tr>
            <tr><td>Dataset (sha256)</td><td className="n mono">{mod.champion.dataset_sha256?.slice(0, 12)}…</td></tr>
            <tr><td>Challenger</td><td className="n">{mod.challenger.nome}, {mod.challenger.modo}</td></tr>
            <tr><td>Política</td><td className="n mono">{mod.politica.versao}: {mod.politica.t_auth.toFixed(4)} / {mod.politica.t_review.toFixed(4)}</td></tr>
          </tbody></table> : <div className="estado">N/D: a API não respondeu.</div>}
          <p className="nota">Promoção é manual e explícita (alias no MLflow Registry), nunca automática por uma métrica subir.</p>
        </div>
      </section>

      <section className="bloco">
        <div className="lado">
          <h2>Desempenho do serviço</h2>
          <p>Latência medida no próprio servidor desde o último reinício, e o teste de carga ponta a ponta com as condições declaradas.</p>
        </div>
        <div className="corpo">
          <div className={s.painel}>
            {lat ? Object.entries<any>(lat).map(([k, v]) => (
              <div key={k}>
                <div className={s.rot}>{k === "interativo" ? "Transações do simulador" : k === "replay" ? "Eventos do replay" : k}, p50</div>
                <div className={s.v}>{v.p50 ?? "N/D"}{v.p50 != null && <small>ms</small>}</div>
                <div className={s.sub}>p95 {v.p95 ?? "N/D"} · p99 {v.p99 ?? "N/D"} ms, n = {fmt.num(v.n)}</div>
              </div>
            )) : <div><div className={s.rot}>Latência</div><div className={s.v}>N/D</div><div className={s.sub}>sem leitura da API</div></div>}
            {carga && (
              <div>
                <div className={s.rot}>Teste de carga, p50 ponta a ponta</div>
                <div className={s.v}>{carga.p50_ms}<small>ms</small></div>
                <div className={s.sub}>{carga.rps} req/s, erros {fmt.pct(carga.taxa_erro, 2)}</div>
              </div>
            )}
          </div>
          {carga && <p className="nota">Teste de carga ({carga.data}): {carga.requisicoes} requisições, {carga.concorrencia} simultâneas, p50 {carga.p50_ms} ms, p95 {carga.p95_ms} ms, p99 {carga.p99_ms} ms ponta a ponta, {carga.rps} req/s, erros {fmt.pct(carga.taxa_erro, 2)}. {carga.condicoes}</p>}
        </div>
      </section>

      <section className="bloco">
        <div className="lado">
          <h2>Replay e rótulos atrasados</h2>
          <p>O período de teste é reapresentado com relógio virtual. A fraude só é confirmada 30 dias depois, e o recall só é publicado para a safra madura.</p>
          <p><Link href="/monitoramento">Evolução mês a mês do modelo congelado</Link></p>
        </div>
        <div className="corpo">
          {!mon ? <div className="estado">Replay ainda sem janela suficiente, ou API sem resposta.</div> : (
            <>
              <div className={s.painel}>
                <div><div className={s.rot}>Relógio virtual</div><div className={s.v}>{mon.relogio_virtual?.slice(0, 10) ?? "N/D"}</div><div className={s.sub}>{mon.relogio_virtual?.slice(11, 16)} {mon.deriva_simulada_valor !== 1 && <b style={{ color: "var(--atencao)" }}>deriva simulada ×{mon.deriva_simulada_valor}</b>}</div></div>
                <div><div className={s.rot}>Eventos processados</div><div className={s.v}>{fmt.num(mon.eventos_processados)}</div><div className={s.sub}>de {fmt.num(mon.total_periodo_teste)} no período</div></div>
                <div><div className={s.rot}>Rótulos maduros</div><div className={s.v}>{fmt.num(mon.rotulos.maduros)}</div><div className={s.sub}>{fmt.num(mon.rotulos.pendentes)} aguardando 30 dias</div></div>
                <div><div className={s.rot}>Cobertura</div><div className={s.v}>{fmt.pct(mon.rotulos.cobertura)}</div><div className={s.sub}>dos eventos já com rótulo</div></div>
              </div>
              <div className={s.duas} style={{ marginTop: 28 }}>
                <div>
                  <h3 className={s.subtitulo}>Drift das entradas (PSI contra a janela policy)</h3>
                  <table><thead><tr><th>Sinal</th><th className="n">PSI</th><th>Leitura</th></tr></thead>
                    <tbody>{Object.entries<any>(mon.psi).map(([k, v]) => {
                      const l = leituraPsi(v);
                      return <tr key={k}><td className="mono">{k}</td><td className="n mono">{v == null ? "N/D" : v.toFixed(3)}</td><td className={`${s.leitura} ${l.c}`}>{l.t}</td></tr>;
                    })}</tbody></table>
                  <p className="nota">{mon.psi_regra}</p>
                </div>
                <div>
                  <h3 className={s.subtitulo}>Safra madura</h3>
                  {perf ? <table><tbody>
                    <tr><td>Recall</td><td className="n">{fmt.pct(perf.recall)}</td></tr>
                    <tr><td>Precisão do alerta</td><td className="n">{fmt.pct(perf.precisao)}</td></tr>
                    <tr><td>Recall em valor</td><td className="n">{fmt.pct(perf.recall_valor)}</td></tr>
                    <tr><td>Challenger (hipotético, em sombra)</td><td className="n">{fmt.pct(perf.challenger_recall_hipotetico)}</td></tr>
                  </tbody></table> : <p className="nota">Nenhuma safra madura ainda: o recall não é publicado antes da confirmação.</p>}
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="bloco">
        <div className="lado">
          <h2>Evidências</h2>
          <p>Testes automatizados com saída e exit code guardados, e prints reais do MLflow privado.</p>
        </div>
        <div className="corpo">
          <div className={s.duas}>
            <div>
              {testes ? <>
                <div className={s.painel} style={{ marginBottom: 16 }}>
                  <div><div className={s.rot}>Passaram</div><div className={s.v}><span className={s.passou}>{testes.passaram}</span></div></div>
                  <div><div className={s.rot}>Falharam</div><div className={s.v}>{testes.falharam}</div></div>
                  <div><div className={s.rot}>Pulados</div><div className={s.v}>{testes.pulados}</div></div>
                </div>
                <p className="nota" style={{ marginTop: 0 }}>{testes.data}, Python {testes.python}, exit code {testes.exit_code}</p>
                <div className={s.testes}><table><tbody>
                  {testes.casos.map((t: any) => <tr key={t.nome}><td>{t.nome}</td><td className={`n ${s.res} ${t.resultado === "passou" ? s.passou : ""}`}>{t.resultado}</td></tr>)}
                </tbody></table></div>
              </> : <div className="estado">Relatório de testes ainda não gerado.</div>}
            </div>
            <div className={s.prints}>
              <figure><img src="/prints/mlflow-experimentos.png" alt="Lista de experimentos no MLflow" /><figcaption>Experimentos e runs no MLflow</figcaption></figure>
              <figure><img src="/prints/mlflow-registry.png" alt="Model Registry com aliases champion e challenger" /><figcaption>Model Registry com os aliases champion e challenger</figcaption></figure>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
