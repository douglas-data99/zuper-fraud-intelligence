"use client";
import { useEffect, useState } from "react";
import Grafico, { COR } from "@/components/Grafico";
import { Cabecalho } from "@/components/Kpi";
import { dado, fmt } from "@/lib/api";
import l from "./lab.module.css";

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
  const FUNCAO: Record<string, string> = { train: "ajuste dos modelos", tuning: "early stopping, Optuna, escolha do Champion", calibration: "calibrador de probabilidade", policy: "cortes da política de custo", test: "avaliação final, intocada" };
  const COR_JANELA: Record<string, string> = { train: "#2C3A4D", tuning: COR.intel, calibration: "#9C8BD9", policy: COR.atencao, test: COR.protecao };
  const totalN = splits.reduce((s, [, v]) => s + v.n, 0);
  const ch = r.teste[r.champion];
  const C = r.experimento_C_sem_valor;
  const estresse: [string, string, any][] = [
    ["Champion completo", "todas as features", B],
    ["C4", "sem tamanho do histórico e sem tempo desde a última compra", C.C4_sem_historico_curto.teste],
    ["C3", "Champion avaliado só em compras abaixo de US$ 800", C.C3_champion_abaixo_800.teste],
    ["C1", "sem as features de valor", C.C1_sem_valor.teste],
    ["C2", "sem valor e sem velocidade de curto prazo", C.C2_sem_valor_e_rajada.teste],
  ];
  const familia = (n: string) => (n.includes(" A") ? "A: só a transação" : n.includes("Dummy") ? "nenhuma" : "B: transação + histórico");

  return (
    <>
      <Cabecalho eyebrow="Tecnologia, ciência de dados" titulo="Data Science Lab">
        <p>Protocolo, modelos, curvas, calibração, explicabilidade e os limites do resultado. Todos os números vêm dos artefatos gerados pela execução do pipeline; código e relatório no <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>.</p>
      </Cabecalho>

      <section className="bloco primeiro">
        <div className="lado"><h2>Dados</h2><p>Base pública Sparkov (CC0), sintética. Nome, endereço e número do cartão não entram no modelo; o cartão vira um hash com sal.</p></div>
        <div className="corpo metricas">
          <div><div className="rot">Transações</div><div className="cifra l">{fmt.num(ing?.bronze?.linhas)}</div><div className="legenda">{q ? `${fmt.num(Number(q.cartoes))} cartões, ${fmt.num(Number(q.merchants))} lojas` : "N/D"}</div></div>
          <div><div className="rot">Fraude no teste</div><div className="cifra l">{fmt.pct(ch.prevalencia, 2)}</div><div className="legenda">a linha de base da curva PR</div></div>
          <div><div className="rot">AP do Champion no teste</div><div className="cifra l intel">{ch.AP.toFixed(3)}</div><div className="legenda">{r.champion}</div></div>
          <div><div className="rot">Ganho do histórico</div><div className="cifra l protecao">+{((B.AP - A.AP) * 100).toFixed(1)} p.p.</div><div className="legenda">AP {A.AP.toFixed(3)} para {B.AP.toFixed(3)}, mesmas linhas</div></div>
        </div>
      </section>

      <section className="bloco">
        <div className="lado"><h2>Protocolo temporal</h2><p>O modelo aprende com o passado e é cobrado no futuro. Cada janela tem uma só função, e o teste só foi lido depois de modelo, calibrador e política salvos.</p></div>
        <div className="corpo">
          <div className={l.linhaTempo} role="img" aria-label="Proporção de transações por janela temporal">
            {splits.map(([k, v]) => (
              <div key={k} style={{ flexGrow: v.n / totalN, background: COR_JANELA[k] }} title={`${k}: ${fmt.num(v.n)} transações`} />
            ))}
          </div>
          <div className="tabela-rolar"><table>
            <thead><tr><th>Janela</th><th>Função</th><th>Início</th><th>Fim</th><th className="n">Transações</th><th className="n">Fraudes</th></tr></thead>
            <tbody>{splits.map(([k, v]) => (
              <tr key={k}><td><span className={l.marca} style={{ background: COR_JANELA[k] }} /><span className="mono">{k}</span></td><td>{FUNCAO[k]}</td>
                <td>{v.inicio.slice(0, 10)}</td><td>{v.fim.slice(0, 10)}</td><td className="n">{fmt.num(v.n)}</td><td className="n">{fmt.num(v.fraudes)}</td></tr>
            ))}</tbody></table></div>
          <p className="nota">Janeiro de 2019 só aquece o histórico. Features point-in-time: toda janela de comportamento termina 1 segundo antes da transação, conferido por revisão independente e pelo teste de paridade entre offline e online.</p>
        </div>
      </section>

      <section className="bloco">
        <div className="lado"><h2>Comparação de modelos</h2><p>Sete configurações no mesmo teste. O Champion foi escolhido pela AP na janela de tuning, não no teste.</p>
          <p>AP soma a precisão em degraus; PR-AUC por trapézio interpola a curva. São cálculos diferentes e aparecem separados.</p></div>
        <div className="corpo tabela-rolar">
          <table className={l.modelos}>
            <thead><tr><th>Modelo</th><th>Features</th><th className="n">AP tuning</th><th className="n">AP teste</th><th className="n">PR-AUC trapézio</th><th className="n">ROC-AUC</th><th className="n">Recall a 0,5% FPR</th><th className="n">Recall a 1% FPR</th></tr></thead>
            <tbody>{nomes.map((n) => (
              <tr key={n} className={n === r.champion ? "destaque" : ""}>
                <td>{n}{n === r.champion ? <span className={l.papel}>Champion</span> : n === r.challenger ? <span className={l.papel}>challenger</span> : null}</td>
                <td>{familia(n)}</td>
                <td className="n mono">{r.tuning[n]?.AP.toFixed(4)}</td>
                <td className="n mono"><span className={l.ap}><i style={{ width: `${r.teste[n].AP * 64}px` }} />{r.teste[n].AP.toFixed(4)}</span></td>
                <td className="n mono">{r.teste[n].PR_AUC_trapezio.toFixed(4)}</td>
                <td className="n mono">{r.teste[n].ROC_AUC.toFixed(4)}</td>
                <td className="n">{fmt.pct(r.teste[n]["recall_fpr_0.5pct"])}</td><td className="n">{fmt.pct(r.teste[n]["recall_fpr_1pct"])}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="bloco">
        <div className="lado"><h2>Curvas no teste</h2><p>Precisão contra recall, com a prevalência como linha do acaso, e ROC ampliada até 5% de legítimas sinalizadas, a faixa que importa para um banco.</p></div>
        <div className={`corpo ${l.duas}`}>
          <div>
            <h3 className={l.grafTit}>Precisão × recall</h3>
            <Grafico altura={300} data={Object.entries<any>(c.modelos).map(([n, m], i) => ({ type: "scatter", mode: "lines", name: `${n} (AP ${m.AP.toFixed(3)})`, x: m.recall, y: m.precision, line: { color: cores[i], width: i === 0 ? 2.5 : 1.3 } }))}
              layout={{ margin: { l: 44, r: 8, t: 8, b: 40 }, xaxis: { title: { text: "recall" } }, yaxis: { title: { text: "precisão" } }, legend: { orientation: "h", y: -0.3, font: { size: 10 } },
                shapes: [{ type: "line", x0: 0, x1: 1, y0: c.prevalencia, y1: c.prevalencia, line: { dash: "dot", color: "#7D8A9C" } }] }} />
          </div>
          <div>
            <h3 className={l.grafTit}>ROC até 5% de falso positivo</h3>
            <Grafico altura={300} data={Object.entries<any>(c.modelos).map(([n, m], i) => ({ type: "scatter", mode: "lines", name: n, x: m.fpr.map((v: number) => v * 100), y: m.tpr.map((v: number) => v * 100), line: { color: cores[i], width: i === 0 ? 2.5 : 1.3 }, showlegend: false }))}
              layout={{ margin: { l: 44, r: 8, t: 8, b: 40 }, xaxis: { title: { text: "% legítimas sinalizadas" }, range: [0, 5] }, yaxis: { title: { text: "% fraudes pegas" } } }} />
          </div>
        </div>
      </section>

      <section className="bloco">
        <div className="lado"><h2>Quanto vale o histórico do cliente</h2><p>Ablação: mesmos parâmetros, mesmas linhas de teste. A só vê a transação; B vê também o comportamento do cartão.</p></div>
        <div className="corpo">
          <div className={l.ablacao}>
            <div><div className="legenda">A: só a transação</div><div className="cifra l">{A.AP.toFixed(3)}</div></div>
            <div className={l.ablacaoBarra} aria-hidden><span style={{ left: `${A.AP * 100}%`, width: `${(B.AP - A.AP) * 100}%` }} /><i style={{ left: `${A.AP * 100}%` }} /><i style={{ left: `${B.AP * 100}%` }} /></div>
            <div><div className="legenda">B: com histórico</div><div className="cifra l protecao">{B.AP.toFixed(3)}</div></div>
          </div>
          <p className="nota">AP de 0 a 1. Recall a 1% de falso positivo: {fmt.pct(A.recall_fpr_1pct)} contra {fmt.pct(B.recall_fpr_1pct)}.</p>
        </div>
      </section>

      <section className="bloco">
        <div className="lado"><h2>Teste de estresse</h2><p>Na Sparkov, nenhuma fraude passa de US$ 1.376 e as fraudes vêm em rajada no mesmo cartão. Retirar esses atalhos mostra quanto o resultado depende do gerador sintético.</p></div>
        <div className="corpo tabela-rolar">
          <table>
            <thead><tr><th>Experimento</th><th>O que muda</th><th className="n">AP no teste</th><th className="n">Recall a 1% FPR</th></tr></thead>
            <tbody>{estresse.map(([k, d, m], i) => (
              <tr key={k} className={i === 0 ? "destaque" : ""}><td>{k}</td><td>{d}</td>
                <td className="n mono"><span className={l.ap}><i style={{ width: `${m.AP * 64}px`, background: m.AP < 0.6 ? "var(--risco)" : undefined }} />{m.AP.toFixed(4)}</span></td>
                <td className="n">{fmt.pct(m.recall_fpr_1pct)}</td></tr>
            ))}</tbody>
          </table>
          <p className="nota">Leitura: o sinal está concentrado em valor e em rajadas, muito mais nítido que em dados reais. A AP de {ch.AP.toFixed(3)} é um teto otimista, não uma promessa para um banco.</p>
        </div>
      </section>

      <section className="bloco">
        <div className="lado"><h2>Calibração</h2><p>O score bruto ordena bem, mas exagera a probabilidade por causa do peso dado às fraudes no treino. O calibrador corrige isso numa janela própria.</p></div>
        <div className={`corpo ${l.duas}`}>
          <Grafico altura={280} data={[
            { type: "scatter", mode: "lines+markers", name: "bruto", x: c.calibracao.bruto.previsto, y: c.calibracao.bruto.observado, line: { color: "#7D8A9C" }, marker: { size: 5 } },
            { type: "scatter", mode: "lines+markers", name: `calibrado (${r.calibracao.escolhida})`, x: c.calibracao.calibrado.previsto, y: c.calibracao.calibrado.observado, line: { color: COR.protecao }, marker: { size: 5 } },
            { type: "scatter", mode: "lines", name: "perfeito", x: [1e-5, 1], y: [1e-5, 1], line: { dash: "dot", color: "#3A4B61" } },
          ]} layout={{ margin: { l: 48, r: 8, t: 8, b: 40 }, xaxis: { type: "log", title: { text: "probabilidade prevista" } }, yaxis: { type: "log", title: { text: "fraude observada" } } }} />
          <div className="metricas" style={{ alignContent: "start" }}>
            <div><div className="rot">Brier bruto</div><div className="cifra m mono">{r.calibracao.brier_teste.bruto.toFixed(6)}</div></div>
            <div><div className="rot">Brier calibrado</div><div className="cifra m mono protecao">{r.calibracao.brier_teste.calibrado.toFixed(6)}</div><div className="legenda">{r.calibracao.escolhida}, escolhido na janela policy</div></div>
          </div>
        </div>
      </section>

      <section className="bloco">
        <div className="lado"><h2>O que mais pesa</h2><p>Média do valor absoluto do SHAP, em log-odds do modelo bruto. Explica o modelo, não a causa da fraude.</p></div>
        <div className="corpo">
          <Grafico altura={360} data={[{ type: "bar", orientation: "h", x: shap.map(([, v]) => v), y: shap.map(([k]) => DESC[k] || k.replace("cat_", "categoria: ")), marker: { color: COR.intel }, hovertemplate: "%{y}: %{x:.3f}<extra></extra>" }]}
            layout={{ margin: { l: 160, r: 10, t: 8, b: 40 }, bargap: 0.35, xaxis: { title: { text: "média |SHAP| (log-odds)" } } }} />
        </div>
      </section>

      <section className="bloco">
        <div className="lado"><h2>Por segmento</h2><p>Política congelada aplicada ao teste, aberta por faixa de valor, tamanho do histórico e categoria.</p></div>
        <div className="corpo tabela-rolar" style={{ maxHeight: 380, overflowY: "auto" }}>
          <table>
            <thead><tr><th>Segmento</th><th className="n">Transações</th><th className="n">Fraudes</th><th className="n">AP</th><th className="n">Fraudes sinalizadas</th></tr></thead>
            {["faixa_valor", "historico", "categoria"].map((sg) => (
              <tbody key={sg}>
                <tr className={l.grupo}><td colSpan={5}>{sg === "faixa_valor" ? "Faixa de valor" : sg === "historico" ? "Tamanho do histórico" : "Categoria"}</td></tr>
                {Object.entries<any>(r.segmentos_teste[sg]).map(([g, v]) => (
                  <tr key={sg + g}><td>{sg === "faixa_valor" ? `US$ ${g}` : g}</td><td className="n">{fmt.num(v.n)}</td><td className="n">{fmt.num(v.fraudes)}</td><td className="n mono">{v.AP == null ? "N/D" : v.AP.toFixed(3)}</td><td className="n">{fmt.pct(v.recall_sinalizado)}</td></tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      {q && (() => {
        const n = (k: string) => (q[k] == null ? null : Number(q[k]));
        const volume = [
          { k: "linhas", nome: "Transações", v: fmt.num(n("linhas")) },
          { k: "cartoes", nome: "Cartões", v: fmt.num(n("cartoes")) },
          { k: "merchants", nome: "Lojas", v: fmt.num(n("merchants")) },
          { k: "maior_valor_fraude", nome: "Maior valor de fraude", v: fmt.usd(n("maior_valor_fraude"), 2) },
        ].filter((x) => q[x.k] != null);
        const achados = [
          { k: "transacoes_acima_maior_fraude", nome: "Transações acima da maior fraude", nota: `todas legítimas: nenhuma fraude passa de ${fmt.usd(n("maior_valor_fraude"), 2)}. É um atalho do gerador, medido no teste de estresse C3.` },
          { k: "empates_mesmo_cartao_mesmo_segundo", nome: "Compras do mesmo cartão no mesmo segundo", nota: "o desempate pelo ID da transação evita que uma compra enxergue a outra nas features (vazamento)." },
        ].filter((x) => q[x.k] != null);
        const NOMES: Record<string, string> = {
          colisao_hash_cartao: "Colisão no código anônimo do cartão",
          tx_id_duplicado: "IDs de transação duplicados",
          nulos_chave: "Campos-chave vazios",
          valor_nao_positivo: "Valores zero ou negativos",
          perfis_com_mais_de_um_endereco: "Cartões com mais de um endereço",
        };
        const usados = new Set([...volume, ...achados].map((x) => x.k));
        const legivel = (k: string) => NOMES[k] ?? (k.charAt(0).toUpperCase() + k.slice(1).replaceAll("_", " "));
        const resto = Object.keys(q).filter((k) => !usados.has(k));
        const zeros = resto.filter((k) => n(k) === 0);
        const outros = resto.filter((k) => n(k) !== 0);
        return (
          <section className="bloco">
            <div className="lado"><h2>Qualidade dos dados</h2><p>Checagens da camada Silver no BigQuery, antes de qualquer modelo.</p></div>
            <div className="corpo">
              <dl className={l.qualidade}>{volume.map((x) => <div key={x.k}><dt>{x.nome}</dt><dd>{x.v}</dd></div>)}</dl>
              <div className={l.achados}>
                {achados.map((x) => (
                  <div key={x.k} className={l.achado}>
                    <div className={l.achadoNum}>{fmt.num(n(x.k))}</div>
                    <div><b>{x.nome}</b><p>{x.nota}</p></div>
                  </div>
                ))}
                {outros.map((k) => (
                  <div key={k} className={l.achado}>
                    <div className={l.achadoNum}>{fmt.num(n(k))}</div>
                    <div><b>{legivel(k)}</b></div>
                  </div>
                ))}
              </div>
              {zeros.length > 0 && (
                <p className={l.semOcorrencia}><b>Verificações sem ocorrência:</b> {zeros.map(legivel).join("; ")}.</p>
              )}
            </div>
          </section>
        );
      })()}

      <section className="bloco">
        <div className="lado"><h2>Limitações</h2><p>O que este resultado não prova.</p></div>
        <ul className={`corpo ${l.limites}`}>
          <li>Dados sintéticos: o gerador tem atalhos (teto de valor das fraudes, rajadas por cartão, horário noturno). Métricas tão altas não se transferem para um banco real.</li>
          <li>Sem dispositivo, IP, destinatário, saldo ou Pix: essas features não existem na base e não foram inventadas.</li>
          <li>Custos e eficácias da política são premissas; num banco viriam de dados internos.</li>
          <li>Fuso horário não informado na base; a hora é usada como está.</li>
          <li>Rótulo atrasado só é simulado no replay; a base não traz data de confirmação.</li>
        </ul>
      </section>
    </>
  );
}
