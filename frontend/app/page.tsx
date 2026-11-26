"use client";
import { useEffect, useState } from "react";
import Grafico from "@/components/Grafico";
import { Kpi } from "@/components/Kpi";
import { api, dado, fmt } from "@/lib/api";

type Acao = { transacoes: number; pct: number; fraudes: number; legitimas: number; valor_fraude: number };
type Pol = Record<"aprovar" | "autenticar" | "investigar", Acao> & {
  n: number; fraudes: number; valor_fraudado: number; valor_fraude_sinalizado: number; valor_potencialmente_evitado: number;
  recall_valor_sinalizado: number; custo_total: number; custo_aprovar_tudo: number; beneficio_liquido_vs_aprovar_tudo: number;
  custo_operacional: number; custo_atrito: number; perda_residual: number;
};
type Dia = { dia: string; transacoes: number; fraudes: number; volume: number; valor_fraude: number; aprovar: number; autenticar: number; investigar: number; fraudes_sinalizadas: number };

export default function Operacoes() {
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

  if (res === false) return <div className="estado erro">Artefatos de avaliação ausentes. Rode o pipeline de treino.</div>;
  if (!res) return <div className="estado">carregando…</div>;
  const p: Pol = res.politica_teste;
  const volume = serie?.reduce((s, d) => s + d.volume, 0) ?? null;
  const alertas = p.autenticar.transacoes + p.investigar.transacoes;
  const latInt = vivo?.latencia_ms?.interativo;
  const latRep = vivo?.latencia_ms?.replay;
  const mon = vivo?.monitoramento;

  return (
    <>
      <span className="aviso">Dados sintéticos públicos · valores em USD (moeda da base) · custos são premissas editáveis</span>
      <div className="cabeca">
        <div>
          <h1>Centro de operações</h1>
          <p>Cada pagamento recebe um score de risco e uma de três ações: <b>aprovar</b>, pedir <b>verificação adicional</b> ou <b>reter para investigação</b>.
            O objetivo não é acertar mais, é proteger dinheiro sem barrar o cliente bom.</p>
        </div>
        <span className="selo teste">Teste histórico: {res.splits.test.inicio.slice(0, 10)} a {res.splits.test.fim.slice(0, 10)} · política congelada antes do teste</span>
      </div>

      <div className="grade g4">
        <Kpi rotulo="Transações avaliadas" valor={fmt.num(p.n)} def="período de teste, nunca usado no treino" selo="teste" />
        <Kpi rotulo="Volume transacionado" valor={fmt.usd(volume)} def="soma dos valores no período" selo="teste" />
        <Kpi rotulo="Fraudes confirmadas" valor={fmt.num(p.fraudes)} def={`${fmt.usd(p.valor_fraudado)} em valor fraudado`} selo="teste" />
        <Kpi rotulo="Valor fraudulento sinalizado" valor={fmt.pct(p.recall_valor_sinalizado)} def={`${fmt.usd(p.valor_fraude_sinalizado)} caíram em verificação ou investigação`} selo="teste" />
      </div>
      <div className="grade g4" style={{ marginTop: 14 }}>
        <Kpi rotulo="Aprovadas direto" valor={fmt.pct(p.aprovar.pct, 2)} def={`${fmt.num(p.aprovar.transacoes)} transações sem atrito`} selo="teste" />
        <Kpi rotulo="Verificação adicional" valor={fmt.pct(p.autenticar.pct, 2)} def={`${fmt.num(p.autenticar.transacoes)} pedidos de confirmação`} selo="teste" />
        <Kpi rotulo="Retidas p/ investigação" valor={fmt.pct(p.investigar.pct, 2)} def={`${fmt.num(p.investigar.transacoes)} casos na fila do analista`} selo="teste" />
        <Kpi rotulo="Taxa de alerta" valor={fmt.pct(alertas / p.n, 2)} def="verificação + investigação sobre o total" selo="teste" />
      </div>

      <div className="secao grade g2">
        <div className="card">
          <h2>Para onde vai cada transação</h2>
          <p className="nota">Fraudes e legítimas em cada ação da política congelada (escala log).</p>
          <Grafico altura={300} data={[
            { type: "bar", name: "Legítimas", x: ["Aprovar", "Verificação", "Investigação"], y: [p.aprovar.legitimas, p.autenticar.legitimas, p.investigar.legitimas], marker: { color: "#3b82f6" } },
            { type: "bar", name: "Fraudes", x: ["Aprovar", "Verificação", "Investigação"], y: [p.aprovar.fraudes, p.autenticar.fraudes, p.investigar.fraudes], marker: { color: "#ef4444" } },
          ]} layout={{ barmode: "group", yaxis: { type: "log", title: { text: "transações" } } }} />
        </div>
        <div className="card">
          <h2>Resultado financeiro simulado</h2>
          <p className="nota">Comparado a aprovar tudo. Depende das premissas de custo e eficácia (página Motor de decisão).</p>
          <table>
            <tbody>
              <tr><td>Perda se aprovasse tudo</td><td className="n">{fmt.usd(p.custo_aprovar_tudo)}</td></tr>
              <tr><td>Perda residual (fraude que escapa ou passa da verificação)</td><td className="n">{fmt.usd(p.perda_residual)}</td></tr>
              <tr><td>Custo operacional (verificações + análises)</td><td className="n">{fmt.usd(p.custo_operacional)}</td></tr>
              <tr><td>Custo de atrito com clientes legítimos</td><td className="n">{fmt.usd(p.custo_atrito)}</td></tr>
              <tr className="destaque"><td><b>Benefício líquido simulado</b></td><td className="n"><b>{fmt.usd(p.beneficio_liquido_vs_aprovar_tudo)}</b></td></tr>
              <tr><td>Valor potencialmente evitado (× eficácia)</td><td className="n">{fmt.usd(p.valor_potencialmente_evitado)}</td></tr>
            </tbody>
          </table>
          <p className="nota">Valor sinalizado ≠ valor protegido: a verificação adicional barra só uma parte das fraudes (premissa de 70%).</p>
        </div>
      </div>

      {serie && serie.length > 0 && (
        <div className="secao card">
          <h2>Decisões por dia no período de teste</h2>
          <Grafico altura={300} data={[
            { type: "bar", name: "Verificação", x: serie.map((d) => d.dia), y: serie.map((d) => d.autenticar), marker: { color: "#f5a524" } },
            { type: "bar", name: "Investigação", x: serie.map((d) => d.dia), y: serie.map((d) => d.investigar), marker: { color: "#ef4444" } },
            { type: "scatter", mode: "lines", name: "Fraudes confirmadas", x: serie.map((d) => d.dia), y: serie.map((d) => d.fraudes), line: { color: "#e8edf3", width: 1.5 }, yaxis: "y" },
          ]} layout={{ barmode: "stack", yaxis: { title: { text: "transações por dia" } } }} />
        </div>
      )}

      <div className="secao">
        <h2>Operação ao vivo <span className="selo vivo">API real</span></h2>
        {erroVivo ? <div className="estado erro">{erroVivo}. Os números históricos acima vêm dos artefatos do teste.</div> : (
          <div className="grade g4">
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
