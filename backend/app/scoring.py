"""Carrega o bundle congelado (modelo + calibrador + schema + política) e pontua uma transação."""
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

from .decision import Politica
from .features import colunas, vetorizar

ROTULOS = {
    "amount_usd": "valor da compra", "log_amount": "valor da compra (escala log)", "hour": "horário",
    "weekday": "dia da semana", "distance_to_merchant_km": "distância casa-loja",
    "avg_amount_7d": "ticket médio 7 dias", "avg_amount_30d": "ticket médio 30 dias", "std_amount_30d": "variação dos valores 30 dias",
    "amount_vs_avg_30d": "valor vs. ticket médio", "tx_count_30min": "compras nos últimos 30 min",
    "tx_count_24h": "compras nas últimas 24 h", "tx_count_7d": "compras em 7 dias", "tx_count_30d": "compras em 30 dias",
    "sum_amount_24h": "gasto nas últimas 24 h", "time_since_last_tx_s": "tempo desde a última compra",
    "is_new_merchant": "loja nova para o cartão", "category_frequency_30d": "hábito na categoria",
    "merchant_distinct_cards_30d": "movimento da loja", "profile_history_count": "tamanho do histórico",
}


class Modelo:
    def __init__(self, pasta: str | Path):
        pasta = Path(pasta)
        self.schema = json.loads((pasta / "feature_schema.json").read_text(encoding="utf-8"))
        pol = json.loads((pasta / "policy.json").read_text(encoding="utf-8"))
        self.politica = Politica(pol["t_auth"], pol["t_review"], pol["versao"])
        self.policy_cfg = pol["config"]
        self.booster = xgb.Booster()
        self.booster.load_model(pasta / "xgb_champion.json")
        self.booster.set_param({"nthread": int(os.environ.get("MODEL_THREADS", "1"))})
        # o modelo salvo guarda TODAS as árvores (inclusive as depois do early stopping);
        # a avaliação e o calibrador usaram só até best_iteration -> a inferência precisa da mesma faixa
        self.faixa = (0, int(self.schema["best_iteration"]) + 1)
        cal = joblib.load(pasta / "calibrador.joblib")
        self.cal_tipo, self._iso, self._sig = cal["tipo"], cal["iso"], cal["sig"]
        chal = pasta / "challenger_rf.joblib"
        self.challenger = joblib.load(chal) if chal.exists() and os.environ.get("SHADOW", "1") == "1" else None
        if self.challenger is not None:
            try:
                self.challenger[-1].set_params(n_jobs=1)
            except Exception:
                pass
        met = pasta / "metricas_teste.json"
        self.metricas = json.loads(met.read_text(encoding="utf-8")) if met.exists() else {}
        self.versao = f"xgb-{self.schema.get('treinado_em', '?').replace(' ', 'T')}"
        self.colunas = colunas("B")
        assert self.colunas == self.schema["colunas"], "schema de features diverge do código"

    def prever_bruto(self, X) -> np.ndarray:
        return self.booster.predict(xgb.DMatrix(X), iteration_range=self.faixa)

    def calibrar(self, s: np.ndarray) -> np.ndarray:
        if self.cal_tipo == "isotonic":
            return self._iso.predict(s)
        p = np.clip(s, 1e-7, 1 - 1e-7)
        return self._sig.predict_proba(np.log(p / (1 - p)).reshape(-1, 1))[:, 1]

    def pontuar(self, feat: dict, com_motivos: bool = True, shadow: bool = True) -> dict:
        t0 = time.perf_counter()
        X = vetorizar(pd.DataFrame([feat]), "B")
        dm = xgb.DMatrix(X)
        bruto = float(self.booster.predict(dm, iteration_range=self.faixa)[0])
        calibrado = float(self.calibrar(np.array([bruto]))[0])
        decisao = self.politica.decidir(calibrado)
        t_inf = (time.perf_counter() - t0) * 1000
        out = {"raw_score": bruto, "calibrated_score": calibrado, "decision": decisao, "inferencia_ms": round(t_inf, 3)}
        if com_motivos:
            contrib = self.booster.predict(dm, pred_contribs=True, iteration_range=self.faixa)[0]
            base, vals = float(contrib[-1]), contrib[:-1]
            pares = sorted(zip(self.colunas, vals, X.iloc[0].values), key=lambda x: -abs(x[1]))
            motivos = []
            for nome, v, x in pares:
                if nome.startswith("cat_") and x == 0:
                    continue  # categoria ausente não é "motivo" para o leitor
                motivos.append({"feature": nome, "rotulo": ROTULOS.get(nome, nome.replace("cat_", "categoria: ")),
                                "valor": None if (x is None or (isinstance(x, float) and math.isnan(x))) else round(float(x), 4),
                                "contribuicao_log_odds": round(float(v), 4), "direcao": "aumenta risco" if v > 0 else "reduz risco"})
                if len(motivos) == 6:
                    break
            out["reasons"] = {"unidade": "log-odds do modelo bruto (antes da calibração); não é % de risco",
                              "base_log_odds": round(base, 4), "itens": motivos}
        if shadow and self.challenger is not None:
            t1 = time.perf_counter()
            s_ch = float(self.challenger.predict_proba(X)[:, 1][0])
            out["shadow"] = {"modelo": self.schema.get("challenger"), "score": s_ch,
                             "decisao_hipotetica": self.politica.decidir(s_ch),
                             "observacao": "score do challenger não calibrado; ação hipotética, nunca aplicada",
                             "ms": round((time.perf_counter() - t1) * 1000, 3)}
        return out
