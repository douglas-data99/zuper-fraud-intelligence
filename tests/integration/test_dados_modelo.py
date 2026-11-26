"""Testes sobre os artefatos reais: splits, paridade offline (BigQuery) x online (API), bundle e calibrador."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.features import Perfil, calcular_online, vetorizar
from app.scoring import Modelo

RAIZ = Path(__file__).resolve().parents[2]
GOLD = RAIZ / "data" / "gold" / "gold_training_features.parquet"
BUNDLE = RAIZ / "artifacts" / "model_bundle"
pytestmark = pytest.mark.skipif(not GOLD.exists() or not BUNDLE.exists(), reason="artefatos locais ausentes")


@pytest.fixture(scope="module")
def gold():
    import db_dtypes  # noqa: F401
    return pd.read_parquet(GOLD)


def test_split_temporal_sem_sobreposicao(gold):
    ordem = ["warmup", "train", "tuning", "calibration", "policy", "test"]
    lim = gold.groupby("split").event_ts.agg(["min", "max"])
    for a, b in zip(ordem, ordem[1:]):
        assert lim.loc[a, "max"] < lim.loc[b, "min"], (a, b)
    assert gold.groupby("split").label.nunique().min() == 2      # as duas classes em toda janela
    assert (gold.split == "test").sum() == 555_719               # arquivo de teste original inteiro


def test_paridade_offline_online(gold):
    """Mesmas transações: features da Gold (SQL no BigQuery) = features da função online (Python)."""
    rng = np.random.default_rng(7)
    teste = gold[gold.split == "test"]
    amostra = teste.iloc[rng.choice(len(teste), 300, replace=False)]
    cols = ["avg_amount_7d", "avg_amount_30d", "std_amount_30d", "amount_vs_avg_30d", "tx_count_30min", "tx_count_24h", "tx_count_7d",
            "tx_count_30d", "sum_amount_24h", "time_since_last_tx_s", "is_new_merchant", "category_frequency_30d", "profile_history_count",
            "hour", "weekday"]
    por_cartao = {k: g.sort_values("event_ts") for k, g in gold[gold.card_key.isin(amostra.card_key)].groupby("card_key")}
    divergencias = 0
    for r in amostra.itertuples(index=False):
        h = por_cartao[r.card_key]
        ts = int(r.event_ts.timestamp())
        hts = ((h.event_ts - pd.Timestamp(0, tz="UTC")) // pd.Timedelta("1s")).values
        anteriores = h[hts <= ts - 1]
        ult = anteriores[((anteriores.event_ts - pd.Timestamp(0, tz="UTC")) // pd.Timedelta("1s")) >= ts - 2592000]
        p = Perfil(r.card_key, 0.0, 0.0, total_tx=len(anteriores), merchants_vistos=set(anteriores.merchant),
                   ultimas=[{"ts": int(x.event_ts.timestamp()), "amount": float(x.amount_usd), "merchant": x.merchant, "category": x.category}
                            for x in ult.itertuples(index=False)], snapshot_ts=ts - 1)
        f = calcular_online(p, {"ts": ts, "amount_usd": float(r.amount_usd), "merchant": r.merchant, "category": r.category,
                                "merch_lat": 0.0, "merch_long": 0.0}, int(r.merchant_distinct_cards_30d))
        for c in cols:
            off, on = getattr(r, c), f[c]
            if (off is None or pd.isna(off)) and on is None:
                continue
            if on is None or off is None or pd.isna(off) or abs(float(off) - float(on)) > 1e-6 * max(1.0, abs(float(off))):
                divergencias += 1
    assert divergencias == 0


def test_bundle_round_trip_reproduz_metrica(gold):
    """Salvar/carregar preserva os scores: AP recalculada com o bundle = AP registrada na avaliação."""
    from sklearn.metrics import average_precision_score
    m = Modelo(BUNDLE)
    teste = gold[gold.split == "test"]
    import xgboost as xgb
    s = m.prever_bruto(vetorizar(teste, "B"))
    registrado = json.loads((BUNDLE / "metricas_teste.json").read_text(encoding="utf-8"))["teste"]["AP"]
    assert average_precision_score(teste.label, s) == pytest.approx(registrado, abs=1e-9)


def test_calibrador_valido_e_monotono():
    m = Modelo(BUNDLE)
    x = np.linspace(0, 1, 2001)
    c = m.calibrar(x)
    assert np.all((c >= 0) & (c <= 1))
    assert np.all(np.diff(c) >= -1e-12)


def test_shadow_nunca_muda_a_decisao(gold):
    m = Modelo(BUNDLE)
    linhas = gold[gold.split == "test"].sample(200, random_state=3)
    for r in linhas.to_dict("records"):
        com = m.pontuar(r, com_motivos=False, shadow=True)
        sem = m.pontuar(r, com_motivos=False, shadow=False)
        assert com["decision"] == sem["decision"] and com["calibrated_score"] == sem["calibrated_score"]


def test_contribuicoes_somam_o_log_odds(gold):
    import xgboost as xgb
    m = Modelo(BUNDLE)
    X = vetorizar(gold[gold.split == "test"].head(50), "B")
    dm = xgb.DMatrix(X)
    contrib = m.booster.predict(dm, pred_contribs=True, iteration_range=m.faixa).sum(axis=1)
    margem = m.booster.predict(dm, output_margin=True, iteration_range=m.faixa)
    assert np.allclose(contrib, margem, atol=1e-4)
