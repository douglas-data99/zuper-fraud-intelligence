"""Treino, comparação, calibração, política e avaliação final, com tudo registrado no MLflow.

Protocolo (configs/data.yaml):
  train      -> ajuste dos modelos
  tuning     -> early stopping, Optuna e escolha do Champion
  calibration-> calibrador (isotônico vs sigmoide)
  policy     -> cortes da política de 3 níveis por custo
  test       -> avaliação final, só depois de tudo congelado
Uso: python train.py [--sem-optuna]
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mlflow
import numpy as np
import optuna
import pandas as pd
import shap
import sklearn
import xgboost as xgb
from sklearn.calibration import calibration_curve
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (auc, average_precision_score, brier_score_loss, confusion_matrix, f1_score,
                             precision_recall_curve, precision_score, recall_score, roc_auc_score, roc_curve)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from common import ARTEFATOS, DADOS, RAIZ, RELATORIOS, config, sha256_arquivo

sys.path.insert(0, str(RAIZ / "backend"))
from app.decision import Politica, otimizar_cortes, resumo_politica  # noqa: E402
from app.features import COMPORTAMENTAIS, colunas, vetorizar  # noqa: E402

CFG, POL = config("model"), config("policy")
MOTIVO_LEITURA = os.environ.get("MOTIVO_LEITURA_TESTE", "execução sem motivo declarado")
SEED = CFG["seed"]
FIG = RELATORIOS / "figures"
MET = RELATORIOS / "metrics"
BUNDLE = ARTEFATOS / "model_bundle"
for p in (FIG, MET, BUNDLE):
    p.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({"figure.dpi": 120, "axes.spines.top": False, "axes.spines.right": False, "font.size": 10})


# ---------------------------------------------------------------- métricas
def recall_em_fpr(y, s, alvo):
    fpr, tpr, _ = roc_curve(y, s)
    return float(np.interp(alvo, fpr, tpr))


def metricas(y, s, valor=None):
    p, r, _ = precision_recall_curve(y, s)
    out = {
        "AP": float(average_precision_score(y, s)),            # average precision (soma em degraus)
        "PR_AUC_trapezio": float(auc(r, p)),                   # área por trapézio: cálculo diferente do AP
        "ROC_AUC": float(roc_auc_score(y, s)),
        "recall_fpr_0.5pct": recall_em_fpr(y, s, 0.005),
        "recall_fpr_1pct": recall_em_fpr(y, s, 0.01),
        "prevalencia": float(np.mean(y)),
        "n": int(len(y)),
        "positivos": int(np.sum(y)),
    }
    return out


def metricas_no_corte(y, s, corte):
    pred = (s >= corte).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {"corte": float(corte), "precision": float(precision_score(y, pred, zero_division=0)),
            "recall": float(recall_score(y, pred)), "f1": float(f1_score(y, pred)),
            "accuracy": float((tp + tn) / len(y)), "fpr": float(fp / max(fp + tn, 1)),
            "taxa_alerta": float(pred.mean()), "tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn)}


# ---------------------------------------------------------------- dados
def carregar():
    caminho = DADOS / "gold" / "gold_training_features.parquet"
    df = pd.read_parquet(caminho)
    df = df.sort_values(["event_ts", "tx_id"]).reset_index(drop=True)
    partes = {k: df[df.split == k] for k in ["train", "tuning", "calibration", "policy", "test"]}
    for k, v in partes.items():
        assert v.label.nunique() == 2, f"split {k} sem as duas classes"
    ordem = ["train", "tuning", "calibration", "policy", "test"]
    for a, b in zip(ordem, ordem[1:]):
        assert partes[a].event_ts.max() < partes[b].event_ts.min(), f"sobreposição {a}/{b}"
    return df, partes, sha256_arquivo(caminho)


def git_versao():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=RAIZ, text=True).strip()
    except Exception:
        return "sem-commit"


# ---------------------------------------------------------------- modelos
def treinar_xgb(Xtr, ytr, Xtu, ytu, params):
    peso = float((ytr == 0).sum() / (ytr == 1).sum())
    m = xgb.XGBClassifier(
        **{k: v for k, v in params.items() if k != "early_stopping_rounds"},
        scale_pos_weight=peso, tree_method="hist", eval_metric="aucpr", n_jobs=-1, random_state=SEED,
        early_stopping_rounds=params.get("early_stopping_rounds", 100),
    )
    m.fit(Xtr, ytr, eval_set=[(Xtu, ytu)], verbose=False)
    return m


def otimizar_xgb(Xtr, ytr, Xtu, ytu):
    oc = CFG["xgboost"]["optuna"]
    base = CFG["xgboost"]["base"]

    def objetivo(trial):
        p = dict(base)
        p.update(
            max_depth=trial.suggest_int("max_depth", 3, 9),
            learning_rate=trial.suggest_float("learning_rate", 0.04, 0.3, log=True),
            min_child_weight=trial.suggest_float("min_child_weight", 1, 30, log=True),
            subsample=trial.suggest_float("subsample", 0.6, 1.0),
            colsample_bytree=trial.suggest_float("colsample_bytree", 0.5, 1.0),
            reg_alpha=trial.suggest_float("reg_alpha", 1e-3, 5.0, log=True),
            reg_lambda=trial.suggest_float("reg_lambda", 1e-2, 10.0, log=True),
        )
        m = treinar_xgb(Xtr, ytr, Xtu, ytu, p)
        trial.set_user_attr("best_iteration", int(m.best_iteration))
        return average_precision_score(ytu, m.predict_proba(Xtu)[:, 1])

    estudo = optuna.create_study(direction="maximize",
                                 sampler=optuna.samplers.TPESampler(seed=SEED, n_startup_trials=oc["startup_trials"]))
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    estudo.optimize(objetivo, n_trials=oc["trials"], timeout=oc["timeout_s"])
    melhor = dict(base)
    melhor.update(estudo.best_params)
    return melhor, estudo


def main():
    t0 = time.time()
    sem_optuna = "--sem-optuna" in sys.argv
    df, P, dataset_hash = carregar()
    y = {k: v.label.values for k, v in P.items()}
    X = {e: {k: vetorizar(v, e) for k, v in P.items()} for e in ("A", "B")}

    # servidor MLflow local (mesma configuração da VPS): artefatos com URI portátil "mlflow-artifacts:/"
    mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5005"))
    exp = mlflow.get_experiment_by_name("zuper-fraud-intelligence")
    exp_id = exp.experiment_id if exp else mlflow.create_experiment("zuper-fraud-intelligence")
    tags_comuns = {"dataset_sha256": dataset_hash, "git": git_versao(), "feature_version": "v1",
                   "python": platform.python_version(), "xgboost": xgb.__version__, "sklearn": sklearn.__version__}

    resultados_tuning, modelos = {}, {}

    def registrar(nome, exp_feat, modelo, params, s_tu, extra=None):
        met = metricas(y["tuning"], s_tu)
        resultados_tuning[nome] = met
        with mlflow.start_run(experiment_id=exp_id, run_name=nome) as run:
            mlflow.set_tags({**tags_comuns, "experimento_features": exp_feat, "fase": "comparacao"})
            mlflow.log_params({k: v for k, v in params.items()})
            mlflow.log_metrics({f"tuning_{k}": v for k, v in met.items() if isinstance(v, float)})
            if extra:
                mlflow.log_metrics(extra)
            modelos[nome] = {"modelo": modelo, "exp": exp_feat, "run_id": run.info.run_id}
        print(f"  {nome:28s} AP(tuning)={met['AP']:.4f}  ROC={met['ROC_AUC']:.4f}")

    print("== modelos (avaliados na janela de tuning)")
    dummy = DummyClassifier(strategy="prior").fit(X["B"]["train"], y["train"])
    registrar("Dummy (prior)", "B", dummy, {"strategy": "prior"}, dummy.predict_proba(X["B"]["tuning"])[:, 1])

    for e in ("A", "B"):
        lr = make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                           LogisticRegression(class_weight="balanced", max_iter=3000, random_state=SEED))
        lr.fit(X[e]["train"], y["train"])
        registrar(f"Regressão Logística {e}", e, lr, {"class_weight": "balanced", "C": 1.0},
                  lr.predict_proba(X[e]["tuning"])[:, 1])

    rfc = CFG["random_forest"]
    rf = make_pipeline(SimpleImputer(strategy="median", add_indicator=True),
                       RandomForestClassifier(n_estimators=rfc["n_estimators"], max_depth=rfc["max_depth"],
                                              min_samples_leaf=rfc["min_samples_leaf"], max_samples=rfc["max_samples"],
                                              class_weight="balanced_subsample", n_jobs=-1, random_state=SEED))
    rf.fit(X["B"]["train"], y["train"])
    registrar("Random Forest B", "B", rf, rfc, rf.predict_proba(X["B"]["tuning"])[:, 1])

    base = CFG["xgboost"]["base"]
    xa = treinar_xgb(X["A"]["train"], y["train"], X["A"]["tuning"], y["tuning"], base)
    registrar("XGBoost A (transacional)", "A", xa, {**base, "best_iteration": xa.best_iteration},
              xa.predict_proba(X["A"]["tuning"])[:, 1])
    xb = treinar_xgb(X["B"]["train"], y["train"], X["B"]["tuning"], y["tuning"], base)
    registrar("XGBoost B (comportamental)", "B", xb, {**base, "best_iteration": xb.best_iteration},
              xb.predict_proba(X["B"]["tuning"])[:, 1])

    leituras = MET / "leituras_do_teste.json"
    hist_leit = json.loads(leituras.read_text(encoding="utf-8")) if leituras.exists() else []
    if not sem_optuna:
        print("== Optuna (XGBoost B)")
        params_opt, estudo = otimizar_xgb(X["B"]["train"], y["train"], X["B"]["tuning"], y["tuning"])
        xo = treinar_xgb(X["B"]["train"], y["train"], X["B"]["tuning"], y["tuning"], params_opt)
        registrar("XGBoost B + Optuna", "B", xo, {**params_opt, "best_iteration": xo.best_iteration,
                  "optuna_trials": len(estudo.trials)}, xo.predict_proba(X["B"]["tuning"])[:, 1])
        pd.DataFrame([{**t.params, "AP_tuning": t.value, "best_iteration": t.user_attrs.get("best_iteration")}
                      for t in estudo.trials]).to_csv(MET / "optuna_trials.csv", index=False)

    # ---- Champion: maior AP na janela de tuning entre os XGBoost B (modelo servível com contribuições nativas)
    candidatos = {k: v for k, v in resultados_tuning.items() if k.startswith("XGBoost B")}
    champion_nome = max(candidatos, key=lambda k: candidatos[k]["AP"])
    champion = modelos[champion_nome]["modelo"]
    challenger_nome = "Random Forest B"
    print(f"== Champion: {champion_nome} | Challenger (shadow): {challenger_nome}")

    # ---- Calibração na janela própria
    s_cal_raw = champion.predict_proba(X["B"]["calibration"])[:, 1]
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(s_cal_raw, y["calibration"])
    sig = LogisticRegression(C=1e6).fit(np.log(np.clip(s_cal_raw, 1e-7, 1 - 1e-7) / (1 - np.clip(s_cal_raw, 1e-7, 1 - 1e-7))).reshape(-1, 1), y["calibration"])

    def logit(p):
        p = np.clip(p, 1e-7, 1 - 1e-7)
        return np.log(p / (1 - p)).reshape(-1, 1)

    s_pol_raw = champion.predict_proba(X["B"]["policy"])[:, 1]
    brier_pol = {"bruto": brier_score_loss(y["policy"], s_pol_raw),
                 "isotonic": brier_score_loss(y["policy"], iso.predict(s_pol_raw)),
                 "sigmoid": brier_score_loss(y["policy"], sig.predict_proba(logit(s_pol_raw))[:, 1])}
    escolha_cal = "isotonic" if brier_pol["isotonic"] <= brier_pol["sigmoid"] else "sigmoid"
    calibrar = (lambda s: iso.predict(s)) if escolha_cal == "isotonic" else (lambda s: sig.predict_proba(logit(s))[:, 1])
    print(f"== calibração escolhida na janela policy: {escolha_cal} | Brier {brier_pol}")

    # ---- Política de 3 níveis na janela policy (score calibrado)
    s_pol = calibrar(s_pol_raw)
    v_pol = P["policy"].amount_usd.values
    otimo = otimizar_cortes(s_pol, y["policy"], v_pol, POL)
    politica = Politica(otimo["t_auth"], otimo["t_review"], POL["versao"])
    print(f"== política: t_auth={politica.t_auth:.4f} t_review={politica.t_review:.4f}")
    sens = {}
    for chave, mults in POL["sensibilidade"].items():
        for mlt in mults:
            c2 = json.loads(json.dumps(POL))
            if chave == "custo_investigacao":
                c2["acoes"]["investigar"]["custo_acao"] *= mlt
            elif chave == "atrito_legitimo":
                for a in c2["acoes"].values():
                    a["atrito_legitimo"] *= mlt
            elif chave == "eficacia_autenticacao":
                c2["acoes"]["autenticar"]["eficacia"] = mlt
            r = otimizar_cortes(s_pol, y["policy"], v_pol, c2)
            sens[f"{chave}={mlt}"] = {k: r[k] for k in ("t_auth", "t_review", "custo_3_niveis", "pct_autenticar", "pct_investigar")}

    # ---- CONGELAR: bundle salvo ANTES de tocar no teste
    # salva SÓ as árvores avaliadas (até best_iteration): o modelo servido é exatamente o modelo medido
    booster_final = champion.get_booster()[: int(champion.best_iteration) + 1]
    booster_final.save_model(BUNDLE / "xgb_champion.json")
    joblib.dump({"tipo": escolha_cal, "iso": iso, "sig": sig}, BUNDLE / "calibrador.joblib")
    joblib.dump(modelos[challenger_nome]["modelo"], BUNDLE / "challenger_rf.joblib")
    schema = {"colunas": colunas("B"), "feature_version": "v1", "champion": champion_nome, "challenger": challenger_nome,
              "dataset_sha256": dataset_hash, "git": git_versao(), "treinado_em": time.strftime("%Y-%m-%d %H:%M:%S"),
              "splits": config("data")["splits"], "best_iteration": int(champion.best_iteration),
              "n_estimators_teto": int(CFG["xgboost"]["base"]["n_estimators"]),
              "early_stopping_parou": bool(champion.best_iteration < CFG["xgboost"]["base"]["n_estimators"] - CFG["xgboost"]["base"]["early_stopping_rounds"]),
              "codigo_sha256": hashlib.sha256(b"".join((RAIZ / f).read_bytes() for f in ["pipelines/train.py", "backend/app/features.py", "backend/app/decision.py", "sql/gold/01_gold_training_features.sql"])).hexdigest()}
    (BUNDLE / "feature_schema.json").write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
    (BUNDLE / "policy.json").write_text(json.dumps({"versao": POL["versao"], "t_auth": politica.t_auth,
                                                     "t_review": politica.t_review, "config": POL, "otimizacao_janela_policy": otimo},
                                                    ensure_ascii=False, indent=2), encoding="utf-8")
    # referência de drift (janela policy): bordas de decis + proporções, para PSI no monitoramento
    ref = {}
    ref_df = X["B"]["policy"].assign(score=s_pol)
    for c in ["score", "amount_usd", "tx_count_24h", "avg_amount_30d", "distance_to_merchant_km", "hour", "time_since_last_tx_s"]:
        v = ref_df[c].dropna().values
        bordas = np.unique(np.quantile(v, np.linspace(0, 1, 11)))
        cont = np.histogram(np.clip(v, bordas[0], bordas[-1]), bins=bordas)[0]
        ref[c] = {"bordas": bordas.tolist(), "proporcoes": (cont / cont.sum()).tolist(), "n": int(len(v))}
    (BUNDLE / "referencia_drift.json").write_text(json.dumps(ref), encoding="utf-8")
    congelado_em = time.strftime("%Y-%m-%d %H:%M:%S")

    # ================================================================ TESTE (uma única vez)
    print("== avaliação final no teste")
    yt, vt = y["test"], P["test"].amount_usd.values
    teste = {}
    for nome, info in modelos.items():
        s = info["modelo"].predict_proba(X[info["exp"]]["test"])[:, 1]
        teste[nome] = metricas(yt, s)
        teste[nome]["recall_valor_top1pct"] = float(vt[(s >= np.quantile(s, 0.99)) & (yt == 1)].sum() / vt[yt == 1].sum())
        if nome == champion_nome:
            s_champ_raw = s
        if nome == challenger_nome:
            s_chal = s
        if nome.startswith("XGBoost A"):
            s_xa = s
    s_champ = calibrar(s_champ_raw)
    brier_teste = {"bruto": float(brier_score_loss(yt, s_champ_raw)), "calibrado": float(brier_score_loss(yt, s_champ))}
    res_pol = resumo_politica(s_champ, yt, vt, politica, POL)
    um_corte = Politica(otimo["t_1_corte"], otimo["t_1_corte"], "1-corte")
    res_1c = resumo_politica(s_champ, yt, vt, um_corte, POL)
    no_corte_review = metricas_no_corte(yt, s_champ, politica.t_review)
    no_corte_auth = metricas_no_corte(yt, s_champ, politica.t_auth)

    # segmentos (política congelada, sem reotimizar)
    seg = {}
    teste_df = P["test"].assign(score=s_champ, acao=politica.decidir_vetor(s_champ))
    faixas = pd.cut(teste_df.amount_usd, [0, 50, 200, 500, 1000, 1e9], labels=["<50", "50-200", "200-500", "500-1000", ">1000"])
    for nome_seg, grupo in [("categoria", teste_df.category), ("faixa_valor", faixas),
                            ("historico", np.where(teste_df.profile_history_count < 20, "frio (<20 tx): artefato, só cartões de fraude", "maduro"))]:
        seg[nome_seg] = {}
        for g, d in teste_df.groupby(grupo, observed=True):
            ok = d.label.nunique() == 2
            seg[nome_seg][str(g)] = {"n": int(len(d)), "fraudes": int(d.label.sum()),
                                     "AP": float(average_precision_score(d.label, d.score)) if ok else None,
                                     "recall_sinalizado": float(((d.acao > 0) & (d.label == 1)).sum() / max(d.label.sum(), 1)),
                                     "taxa_alerta": float((d.acao > 0).mean())}

    # Experimento C (estresse): quanto o modelo depende de atalhos do gerador Sparkov?
    #   C1: sem features de valor (fraude nunca passa de US$ 1.376 na base)
    #   C2: sem features de valor nem de rajada (velocidade/ticket recente: fraudes vêm em sequência no mesmo cartão)
    #   C3: Champion avaliado só em compras abaixo de US$ 800 (fora da faixa onde o valor quase "entrega" a fraude)
    grupos_c = {
        "C1_sem_valor": ["amount_usd", "log_amount", "amount_vs_avg_30d", "sum_amount_24h"],
        "C2_sem_valor_e_rajada": ["amount_usd", "log_amount", "amount_vs_avg_30d", "sum_amount_24h", "avg_amount_7d",
                                  "avg_amount_30d", "std_amount_30d", "tx_count_30min", "tx_count_24h"],
        "C4_sem_historico_curto": ["profile_history_count", "time_since_last_tx_s"],  # cartões só de fraude: histórico curto vira rótulo
    }
    exp_c = {}
    for nome_c, remover in grupos_c.items():
        cols_c = [c for c in colunas("B") if c not in remover]
        xc = treinar_xgb(X["B"]["train"][cols_c], y["train"], X["B"]["tuning"][cols_c], y["tuning"], base)
        exp_c[nome_c] = {"features_removidas": remover,
                         "tuning": metricas(y["tuning"], xc.predict_proba(X["B"]["tuning"][cols_c])[:, 1]),
                         "teste": metricas(yt, xc.predict_proba(X["B"]["test"][cols_c])[:, 1])}
    abaixo = vt < 800
    exp_c["C3_champion_abaixo_800"] = {"teste": metricas(yt[abaixo], s_champ_raw[abaixo]),
                                       "transacoes": int(abaixo.sum()), "fraudes": int(yt[abaixo].sum())}

    # SHAP (explica o modelo BRUTO, em log-odds) numa amostra do teste
    amostra = X["B"]["test"].sample(CFG["shap_amostra"], random_state=SEED)
    contrib = champion.get_booster().predict(xgb.DMatrix(amostra), pred_contribs=True)
    shap_vals = contrib[:, :-1]
    imp = pd.Series(np.abs(shap_vals).mean(0), index=amostra.columns).sort_values(ascending=False)

    # ---------------------------------------------------------------- figuras e curvas para a interface
    nomes_curva = [champion_nome, "XGBoost A (transacional)", "Regressão Logística B", challenger_nome]
    scores_curva = {}
    for nome in nomes_curva:
        info = modelos[nome]
        scores_curva[nome] = info["modelo"].predict_proba(X[info["exp"]]["test"])[:, 1]
    curvas = {"prevalencia": float(yt.mean()), "modelos": {}}
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4))
    for nome, s in scores_curva.items():
        p, r, _ = precision_recall_curve(yt, s)
        f, t, _ = roc_curve(yt, s)
        idx_pr = np.unique(np.linspace(0, len(p) - 1, 300).astype(int))
        idx_roc = np.unique(np.linspace(0, len(f) - 1, 300).astype(int))
        curvas["modelos"][nome] = {"precision": p[idx_pr].round(4).tolist(), "recall": r[idx_pr].round(4).tolist(),
                                   "fpr": f[idx_roc].round(5).tolist(), "tpr": t[idx_roc].round(4).tolist(),
                                   "AP": teste[nome]["AP"], "ROC_AUC": teste[nome]["ROC_AUC"]}
        a1.plot(r, p, label=f"{nome} (AP {teste[nome]['AP']:.3f})", lw=2 if nome == champion_nome else 1.2)
        a2.plot(f * 100, t * 100, lw=2 if nome == champion_nome else 1.2)
    a1.axhline(yt.mean(), ls=":", c="k", lw=.8)
    a1.set(xlabel="recall", ylabel="precisão", title="Precisão × recall no teste")
    a1.legend(fontsize=7)
    a2.set(xlim=(0, 5), xlabel="% de legítimas sinalizadas (FPR)", ylabel="% de fraudes pegas", title="ROC (até 5% de FPR)")
    plt.tight_layout(); plt.savefig(FIG / "curvas_teste.png", bbox_inches="tight"); plt.close()

    fr_b, mp_b = calibration_curve(yt, s_champ_raw, n_bins=10, strategy="quantile")
    fr_c, mp_c = calibration_curve(yt, s_champ, n_bins=10, strategy="quantile")
    curvas["calibracao"] = {"bruto": {"previsto": mp_b.round(5).tolist(), "observado": fr_b.round(5).tolist()},
                            "calibrado": {"previsto": mp_c.round(5).tolist(), "observado": fr_c.round(5).tolist()}}
    fig, ax = plt.subplots(figsize=(5, 4.2))
    ax.plot(mp_b, fr_b, "o-", label="bruto", c="#9aa5b1"); ax.plot(mp_c, fr_c, "o-", label="calibrado", c="#1f9d6b")
    ax.plot([1e-4, 1], [1e-4, 1], ":", c="k", lw=.8); ax.set(xscale="log", yscale="log", xlabel="previsto", ylabel="observado",
                                                           title="Calibração no teste"); ax.legend()
    plt.tight_layout(); plt.savefig(FIG / "calibracao_teste.png", bbox_inches="tight"); plt.close()

    fig, ax = plt.subplots(figsize=(6.5, 5))
    imp.head(15)[::-1].plot.barh(ax=ax, color="#1f6fd1"); ax.set(xlabel="média |SHAP| (log-odds)", title="O que mais pesa no Champion")
    plt.tight_layout(); plt.savefig(FIG / "shap_global.png", bbox_inches="tight"); plt.close()
    shap.summary_plot(shap_vals, amostra, max_display=14, show=False, plot_size=(8, 5.5))
    plt.tight_layout(); plt.savefig(FIG / "shap_beeswarm.png", bbox_inches="tight"); plt.close()

    # ablação A x B nas mesmas linhas
    ab = {"A": teste["XGBoost A (transacional)"], "B": teste["XGBoost B (comportamental)"]}  # mesmos parâmetros base

    # Shadow: concordância de ações champion x challenger (challenger calibrado no mesmo esquema seria outro bundle;
    # aqui o challenger só gera score, a comparação é de ranking)
    corr_rank = float(pd.Series(s_champ_raw).rank().corr(pd.Series(s_chal).rank()))

    saida = {
        "gerado_em": time.strftime("%Y-%m-%d %H:%M:%S"), "congelado_antes_do_teste_em": congelado_em,
        "dataset_sha256": dataset_hash, "git": git_versao(),
        "splits": {k: {"n": int(len(v)), "fraudes": int(v.label.sum()), "inicio": str(v.event_ts.min()), "fim": str(v.event_ts.max())} for k, v in P.items()},
        "tuning": resultados_tuning, "teste": teste, "champion": champion_nome, "challenger": challenger_nome,
        "ablacao_A_vs_B_teste": ab, "experimento_C_sem_valor": exp_c,
        "calibracao": {"escolhida": escolha_cal, "brier_janela_policy": brier_pol, "brier_teste": brier_teste},
        "politica": {"t_auth": politica.t_auth, "t_review": politica.t_review, "versao": politica.versao,
                     "otimizacao_janela_policy": otimo, "sensibilidade": sens},
        "politica_teste": res_pol, "politica_1_corte_teste": res_1c,
        "metricas_no_corte_review": no_corte_review, "metricas_no_corte_auth": no_corte_auth,
        "segmentos_teste": seg, "shap_top": imp.head(20).round(5).to_dict(), "shadow_corr_ranking": corr_rank,
        "duracao_s": round(time.time() - t0, 1),
        "optuna_trials_executados": len(estudo.trials) if not sem_optuna else 0,
        "leituras_do_teste": hist_leit + [{"quando": time.strftime("%Y-%m-%d %H:%M:%S"), "motivo": MOTIVO_LEITURA}],
    }
    leituras.write_text(json.dumps(saida["leituras_do_teste"], ensure_ascii=False, indent=2), encoding="utf-8")
    (MET / "resultados.json").write_text(json.dumps(saida, ensure_ascii=False, indent=2, default=float), encoding="utf-8")
    (MET / "curvas.json").write_text(json.dumps(curvas, ensure_ascii=False), encoding="utf-8")
    (BUNDLE / "metricas_teste.json").write_text(json.dumps({"teste": teste[champion_nome], "politica": res_pol}, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- dados para a interface (gerados por esta execução)
    # (1) janela policy (validação) para o simulador de cortes: todas as fraudes + amostra de legítimas com peso
    rng = np.random.default_rng(SEED)
    pol_df = P["policy"].assign(score=s_pol)
    leg = pol_df[pol_df.label == 0]
    amostra_leg = leg.iloc[rng.choice(len(leg), size=min(25000, len(leg)), replace=False)]
    peso_leg = len(leg) / len(amostra_leg)
    linhas = pd.concat([pol_df[pol_df.label == 1].assign(w=1.0), amostra_leg.assign(w=peso_leg)])
    (MET / "politica_amostra.json").write_text(json.dumps({
        "janela": "policy (validação, 2020-05-01 a 2020-06-21)", "n_real": int(len(pol_df)), "peso_legitimas": peso_leg,
        "s": linhas.score.round(6).tolist(), "y": linhas.label.astype(int).tolist(), "v": linhas.amount_usd.round(2).tolist(),
        "w": linhas.w.round(4).tolist(), "politica_congelada": {"t_auth": politica.t_auth, "t_review": politica.t_review},
        "premissas": POL["acoes"]}), encoding="utf-8")
    # (2) série diária do teste sob a política congelada (centro de operações, "resultado histórico de teste")
    serie = teste_df.assign(dia=teste_df.event_ts.dt.strftime("%Y-%m-%d"), acao_nome=pd.Categorical.from_codes(teste_df.acao, ["aprovar", "autenticar", "investigar"]))
    diario = serie.groupby("dia").agg(transacoes=("label", "size"), fraudes=("label", "sum"), volume=("amount_usd", "sum"),
                                      valor_fraude=("amount_usd", lambda s: float(s[serie.loc[s.index, "label"] == 1].sum())),
                                      aprovar=("acao", lambda a: int((a == 0).sum())), autenticar=("acao", lambda a: int((a == 1).sum())),
                                      investigar=("acao", lambda a: int((a == 2).sum())),
                                      fraudes_sinalizadas=("acao", lambda a: int(((a > 0) & (serie.loc[a.index, "label"] == 1)).sum())))
    (MET / "serie_diaria_teste.json").write_text(diario.reset_index().round(2).to_json(orient="records", force_ascii=False), encoding="utf-8")
    pd.DataFrame(sens).T.to_csv(MET / "sensibilidade_politica.csv")

    # ---- MLflow: run do Champion final + registro com aliases
    with mlflow.start_run(experiment_id=exp_id, run_name=f"CHAMPION final: {champion_nome}") as run:
        mlflow.set_tags({**tags_comuns, "fase": "final", "champion": champion_nome, "challenger": challenger_nome,
                         "calibracao": escolha_cal, "policy_version": POL["versao"]})
        mlflow.log_params({"t_auth": politica.t_auth, "t_review": politica.t_review, "best_iteration": int(champion.best_iteration)})
        mlflow.log_metrics({f"teste_{k}": v for k, v in teste[champion_nome].items() if isinstance(v, float)})
        mlflow.log_metrics({"teste_brier_bruto": brier_teste["bruto"], "teste_brier_calibrado": brier_teste["calibrado"],
                            "teste_beneficio_liquido_usd": res_pol["beneficio_liquido_vs_aprovar_tudo"],
                            "teste_recall_valor_sinalizado": res_pol["recall_valor_sinalizado"]})
        mlflow.log_artifacts(str(BUNDLE), artifact_path="bundle")
        mlflow.log_artifacts(str(FIG), artifact_path="figuras")
        mlflow.xgboost.log_model(champion, artifact_path="modelo", registered_model_name="zuper-fraud-xgb")
    cli = mlflow.MlflowClient()
    ultima = max(cli.search_model_versions("name='zuper-fraud-xgb'"), key=lambda v: int(v.version))
    cli.set_registered_model_alias("zuper-fraud-xgb", "champion", ultima.version)
    with mlflow.start_run(experiment_id=exp_id, run_name=f"CHALLENGER: {challenger_nome}"):
        mlflow.set_tags({**tags_comuns, "fase": "shadow"})
        mlflow.log_metrics({f"teste_{k}": v for k, v in teste[challenger_nome].items() if isinstance(v, float)})
        mlflow.sklearn.log_model(modelos[challenger_nome]["modelo"], artifact_path="modelo", registered_model_name="zuper-fraud-rf")
    ult_rf = max(cli.search_model_versions("name='zuper-fraud-rf'"), key=lambda v: int(v.version))
    cli.set_registered_model_alias("zuper-fraud-rf", "challenger", ult_rf.version)

    print(json.dumps({"champion": champion_nome, "teste": teste[champion_nome], "ablacao": {k: v["AP"] for k, v in ab.items()},
                      "politica": {k: res_pol[k] for k in ("beneficio_liquido_vs_aprovar_tudo", "recall_valor_sinalizado", "custo_total", "custo_aprovar_tudo")},
                      "duracao_s": saida["duracao_s"]}, ensure_ascii=False, indent=1, default=float))


if __name__ == "__main__":
    main()
