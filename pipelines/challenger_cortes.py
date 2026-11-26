"""Cortes próprios do challenger (Random Forest) para a comparação em modo sombra ser justa.

O score do RF não é calibrado; usar os cortes calibrados do XGBoost nele distorce a comparação (revisão E3-E5).
Aqui os cortes do RF são escolhidos na JANELA POLICY para dar a MESMA taxa de verificação e de investigação do
Champion. O teste não é usado.
"""
import json
import sys

import joblib
import numpy as np
import pandas as pd

from common import ARTEFATOS, DADOS, RAIZ

sys.path.insert(0, str(RAIZ / "backend"))
from app.features import vetorizar  # noqa: E402

B = ARTEFATOS / "model_bundle"
pol = json.loads((B / "policy.json").read_text(encoding="utf-8"))
o = pol["otimizacao_janela_policy"]
rf = joblib.load(B / "challenger_rf.joblib")
df = pd.read_parquet(DADOS / "gold" / "gold_training_features.parquet", filters=[("split", "==", "policy")])
s = rf.predict_proba(vetorizar(df, "B"))[:, 1]
t_review = float(np.quantile(s, 1 - o["pct_investigar"]))
t_auth = float(np.quantile(s, 1 - o["pct_investigar"] - o["pct_autenticar"]))
saida = {"t_auth": t_auth, "t_review": t_review, "criterio": "mesma taxa de alerta do Champion na janela policy",
         "pct_autenticar_alvo": o["pct_autenticar"], "pct_investigar_alvo": o["pct_investigar"],
         "pct_autenticar_obtido": float(((s >= t_auth) & (s < t_review)).mean()), "pct_investigar_obtido": float((s >= t_review).mean())}
(B / "politica_challenger.json").write_text(json.dumps(saida, indent=2), encoding="utf-8")
print(saida)
