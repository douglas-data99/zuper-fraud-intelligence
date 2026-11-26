"""Monitoramento pós-implantação: o modelo congelado diante de casos novos, mês a mês e semana a semana.

Ideia: modelo, calibrador e cortes foram salvos ANTES do período de teste (21/06 a 31/12/2020). Para o modelo,
esses meses são exatamente "produção": casos que ele nunca viu. Este script reapresenta o teste em ordem
cronológica e mede, por período, se ele continua acertando como acertava na validação.

- Só INFERÊNCIA com o bundle congelado (artifacts/model_bundle). Nenhum retreino, nenhum corte novo.
- Roda localmente sobre o Parquet Gold já exportado. Não consulta o BigQuery.
- Referência = janela policy (validação, a última antes do congelamento), medida do mesmo jeito.
- Maturação: em produção o rótulo de fraude chega com atraso (até 30 dias). Períodos que terminam nos últimos
  30 dias do teste são marcados como "rótulo imaturo": aqui o rótulo existe porque a base é histórica,
  mas um banco ainda não o teria no fechamento do período.

Saída: reports/metrics/monitoramento.json
"""
import json
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

from common import ARTEFATOS, DADOS, RAIZ

sys.path.insert(0, str(RAIZ / "backend"))
from app.decision import resumo_politica  # noqa: E402
from app.features import vetorizar  # noqa: E402
from app.replay import psi  # noqa: E402
from app.scoring import Modelo  # noqa: E402

MET = RAIZ / "reports" / "metrics"
MATURACAO_DIAS = 30
SINAIS_PSI = ["score", "amount_usd", "tx_count_24h", "avg_amount_30d", "distance_to_merchant_km", "time_since_last_tx_s"]
# alarmes declarados ANTES de olhar os resultados (mesma lógica de um runbook)
REGRAS = {
    "recall_queda_pp": 0.05,        # recall do alerta cai mais de 5 p.p. abaixo da referência
    "precisao_queda_pp": 0.10,      # precisão do alerta cai mais de 10 p.p.
    "psi_atencao": 0.10,
    "psi_investigar": 0.25,
    "taxa_alerta_fator": 1.5,       # taxa de alerta 50% acima da referência (fila de analistas estoura)
}

modelo = Modelo(ARTEFATOS / "model_bundle")
ref_drift = json.loads((ARTEFATOS / "model_bundle" / "referencia_drift.json").read_text(encoding="utf-8"))
cfg = modelo.policy_cfg

df = pd.read_parquet(DADOS / "gold" / "gold_training_features.parquet", filters=[("split", "in", ["policy", "test"])])
df = df.sort_values(["event_ts", "tx_id"]).reset_index(drop=True)
bruto = modelo.prever_bruto(vetorizar(df, "B"))
df["score"] = modelo.calibrar(bruto)
df["bruto"] = bruto
df["acao"] = modelo.politica.decidir_vetor(df["score"].values)


def medir(p: pd.DataFrame) -> dict:
    y, v, s = p.label.values.astype(int), p.amount_usd.values.astype(float), p.score.values
    alerta = p.acao.values > 0
    tp = int((alerta & (y == 1)).sum())
    r = resumo_politica(s, y, v, modelo.politica, cfg)
    out = {
        "n": int(len(p)), "fraudes": int(y.sum()), "prevalencia": float(y.mean()),
        "alertas": int(alerta.sum()), "taxa_alerta": float(alerta.mean()),
        "aprovar": r["aprovar"]["transacoes"], "autenticar": r["autenticar"]["transacoes"], "investigar": r["investigar"]["transacoes"],
        "recall": tp / max(int(y.sum()), 1) if y.sum() else None,
        "precisao_alerta": tp / max(int(alerta.sum()), 1) if alerta.sum() else None,
        "fraudes_que_passaram": int((~alerta & (y == 1)).sum()),
        "valor_fraudado": r["valor_fraudado"], "valor_sinalizado": r["valor_fraude_sinalizado"],
        "recall_valor": r["recall_valor_sinalizado"] if y.sum() else None,
        "beneficio_liquido": r["beneficio_liquido_vs_aprovar_tudo"],
        "AP": float(average_precision_score(y, p.bruto.values)) if 0 < y.sum() < len(y) else None,
        "ROC_AUC": float(roc_auc_score(y, p.bruto.values)) if 0 < y.sum() < len(y) else None,
        "psi": {c: psi(ref_drift[c], p[c].astype(float).values) for c in SINAIS_PSI},
    }
    return out


def alarmes(m: dict, ref: dict) -> list[str]:
    a = []
    if m["recall"] is not None and m["recall"] < ref["recall"] - REGRAS["recall_queda_pp"]:
        a.append("recall abaixo da referência")
    if m["precisao_alerta"] is not None and m["precisao_alerta"] < ref["precisao_alerta"] - REGRAS["precisao_queda_pp"]:
        a.append("precisão do alerta abaixo da referência")
    if m["taxa_alerta"] > ref["taxa_alerta"] * REGRAS["taxa_alerta_fator"]:
        a.append("taxa de alerta acima da capacidade")
    for c, v in m["psi"].items():
        if v is not None and v >= REGRAS["psi_investigar"]:
            a.append(f"drift forte em {c}")
    return a


pol, teste = df[df.split == "policy"], df[df.split == "test"].copy()
referencia = medir(pol)
fim_teste = teste.event_ts.max()
limite_maduro = fim_teste - pd.Timedelta(days=MATURACAO_DIAS)


def por_periodo(chave: pd.Series, rotulo) -> list[dict]:
    linhas = []
    for k, p in teste.groupby(chave, sort=True):
        m = medir(p)
        ini, fim = p.event_ts.min(), p.event_ts.max()
        m.update({"periodo": rotulo(k), "inicio": ini.strftime("%Y-%m-%d"), "fim": fim.strftime("%Y-%m-%d"),
                  "dias": int((fim.normalize() - ini.normalize()).days) + 1,
                  "rotulo_maduro": bool(fim <= limite_maduro), "alarmes": alarmes(m, referencia)})
        linhas.append(m)
    return linhas


MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
mensal = por_periodo(teste.event_ts.dt.tz_localize(None).dt.to_period("M"), lambda k: f"{MESES[k.month - 1]}/{str(k.year)[2:]}")
semanal = por_periodo(teste.event_ts.dt.tz_localize(None).dt.to_period("W-SUN"), lambda k: k.start_time.strftime("%Y-%m-%d"))

# conferência: a soma dos períodos tem de bater com a política congelada medida no treino (resultados.json)
total = medir(teste)
oficial = json.loads((MET / "resultados.json").read_text(encoding="utf-8"))["politica_teste"]
for k in ("aprovar", "autenticar", "investigar"):
    assert total[k] == oficial[k]["transacoes"], f"divergência em {k}: {total[k]} != {oficial[k]['transacoes']}"
    assert sum(m[k] for m in mensal) == oficial[k]["transacoes"]
assert total["n"] == oficial["n"] and total["fraudes"] == oficial["fraudes"]
assert abs(total["beneficio_liquido"] - oficial["beneficio_liquido_vs_aprovar_tudo"]) < 1e-6

saida = {
    "descricao": "Modelo congelado antes do teste, reapresentado em ordem cronológica como se fosse produção. "
                 "Só inferência com o bundle salvo; nenhum retreino.",
    "modelo": modelo.versao, "politica": modelo.politica.versao,
    "cortes": {"t_auth": modelo.politica.t_auth, "t_review": modelo.politica.t_review},
    "maturacao_dias": MATURACAO_DIAS, "limite_rotulo_maduro": limite_maduro.strftime("%Y-%m-%d"),
    "regras_alarme": REGRAS,
    "referencia": {"janela": "policy (validação, 01/05 a 21/06/2020)", **referencia},
    "total_teste": total, "mensal": mensal, "semanal": semanal,
    "conferencia": "contagens por ação, fraudes e benefício batem com resultados.json (politica_teste)",
}
(MET / "monitoramento.json").write_text(json.dumps(saida, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
print("referência:", {k: referencia[k] for k in ("recall", "precisao_alerta", "taxa_alerta", "AP")})
for m in mensal:
    print(m["periodo"], m["n"], "recall", round(m["recall"], 4), "prec", round(m["precisao_alerta"], 4), "AP", round(m["AP"], 4),
          "psi_score", m["psi"]["score"] and round(m["psi"]["score"], 3), "maduro", m["rotulo_maduro"], m["alarmes"])
print("semanas com alarme:", sum(bool(s["alarmes"]) for s in semanal), "de", len(semanal))
