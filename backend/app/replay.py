"""Replay com relógio virtual: reapresenta o período de teste em ordem cronológica, como se fosse produção.

- O modelo nunca vê o rótulo. O rótulo é "confirmado" só 30 dias VIRTUAIS depois (rótulo atrasado).
- Monitoramento antes dos rótulos: PSI de score e de features contra a referência da janela policy, taxa de alerta, volume.
- Depois da maturação: precisão, recall, AP e recall em valor só sobre a safra madura, com cobertura informada.
- Opcional: `deriva_valor` multiplica os valores (mudança de distribuição simulada, sinalizada como tal).
Controlado por fraud:replay:comando ({"acao": "iniciar"|"pausar", "eps": float, "deriva_valor": float}).
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .features import calcular_online
from .main_deps import modelo_padrao
from .store import TTL_REPLAY, Store

MATURACAO_S = 30 * 86400


def psi(ref: dict, valores: np.ndarray) -> float | None:
    valores = valores[~np.isnan(valores)]
    if len(valores) < 200:
        return None
    b = np.array(ref["bordas"])
    cont = np.histogram(np.clip(valores, b[0], b[-1]), bins=b)[0]
    q = (cont + 0.5) / (cont.sum() + 0.5 * len(cont))          # suavização para bins vazios
    p = (np.array(ref["proporcoes"]) * ref["n"] + 0.5) / (ref["n"] + 0.5 * len(cont))
    return float(np.sum((q - p) * np.log(q / p)))


def main():
    st = Store(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), timeout=10)
    modelo = modelo_padrao()
    pasta = os.environ.get("SERVING_DIR", "/app/serving")
    df = pd.read_parquet(f"{pasta}/replay.parquet")
    ref = json.load(open(os.path.join(os.environ.get("BUNDLE_DIR", "/app/bundle"), "referencia_drift.json")))
    cursor = int(st.r.get("fraud:replay:cursor") or 0)
    # "hour" fica fora do PSI: numa janela curta de replay o relógio cobre poucas horas e o PSI acusaria drift falso
    ref = {k: v for k, v in ref.items() if k != "hour"}
    JANELA = 20000
    janela = {k: [] for k in ref}
    acoes = []
    print(f"replay pronto: {len(df)} eventos, cursor={cursor}", flush=True)
    while True:
        cmd = json.loads(st.r.get("fraud:replay:comando") or '{"acao": "pausar"}')
        if cmd["acao"] != "iniciar" or cursor >= len(df):
            st.r.set("fraud:replay:status", json.dumps({"status": "parado" if cursor < len(df) else "fim do período de teste",
                                                        "cursor": cursor, "total": len(df)}))
            time.sleep(2)
            continue
        eps, deriva = float(cmd.get("eps", 20)), float(cmd.get("deriva_valor", 1.0))
        if cursor % 50 == 0:
            st.r.set("fraud:replay:status", json.dumps({"status": "rodando", "cursor": cursor, "total": len(df)}))
        r = df.iloc[cursor]
        t0 = time.perf_counter()
        perfil, _ = st.perfil(r.card_key)
        minfo = st.merchant(r.merchant)
        if perfil is None or minfo is None:
            cursor += 1
            continue
        tx = {"ts": int(r.ts_sec), "amount_usd": float(r.amount_usd) * deriva, "merchant": r.merchant, "category": r.category,
              "merch_lat": float(r.merch_lat), "merch_long": float(r.merch_long)}
        feat = calcular_online(perfil, tx, minfo["merchant_distinct_cards_30d"])
        res = modelo.pontuar(feat, com_motivos=True, shadow=True)
        ms = (time.perf_counter() - t0) * 1000
        ev = {"tx_id": r.tx_id, "card_key": r.card_key, "tx": tx, "features": feat, "origem": "replay",
              "raw_score": res["raw_score"], "calibrated_score": res["calibrated_score"], "decision": res["decision"],
              "challenger_score": res["shadow"]["score"] if res.get("shadow") else None,
              "challenger_decision": res["shadow"]["decisao_hipotetica"] if res.get("shadow") else None,
              "policy_version": modelo.politica.versao, "t_auth": modelo.politica.t_auth, "t_review": modelo.politica.t_review,
              "model_version": modelo.versao, "reasons": res["reasons"]["itens"], "recebido_em": time.time(), "latency_ms": round(ms, 3)}
        if st.reservar_tx(r.tx_id, TTL_REPLAY):
            st.publicar(ev)
            st.r.set(f"fraud:status:{r.tx_id}", "publicado", ex=TTL_REPLAY)
            st.registrar_latencia(ms, res["decision"], "replay")
            # rótulo guardado com liberação em D+30 virtual (o modelo não usa)
            st.r.zadd("fraud:labels:pendentes", {json.dumps({"tx_id": r.tx_id, "label": int(r.is_fraud), "valor": float(r.amount_usd),
                                                              "score": res["calibrated_score"], "decisao": res["decision"],
                                                              "challenger": ev["challenger_decision"], "ts": int(r.ts_sec)}): int(r.ts_sec) + MATURACAO_S})
        st.r.set("fraud:clock", int(r.ts_sec))
        cursor += 1
        st.r.set("fraud:replay:cursor", cursor)
        for k in janela:
            janela[k].append(res["calibrated_score"] if k == "score" else (feat.get(k) if feat.get(k) is not None else np.nan))
            janela[k] = janela[k][-JANELA:]
        acoes = (acoes + [res["decision"]])[-JANELA:]
        if cursor % 250 == 0:
            atualizar_monitoramento(st, ref, janela, acoes, int(r.ts_sec), cursor, len(df), deriva)
        time.sleep(max(0.0, 1.0 / eps - (time.perf_counter() - t0)))


def atualizar_monitoramento(st, ref, janela, acoes, relogio, cursor, total, deriva):
    # libera rótulos maduros
    # rótulos que completaram 30 dias virtuais viram contadores agregados (memória constante)
    maduros_novos = st.r.zrangebyscore("fraud:labels:pendentes", 0, relogio)
    if maduros_novos:
        agg = {"n": 0, "fraudes": 0, "alertas": 0, "fraudes_alertadas": 0, "valor_fraude": 0.0, "valor_fraude_alertado": 0.0,
               "challenger_fraudes_alertadas": 0}
        for x in maduros_novos:
            m = json.loads(x)
            alerta = m["decisao"] != "aprovar"
            agg["n"] += 1
            agg["alertas"] += int(alerta)
            if m["label"]:
                agg["fraudes"] += 1
                agg["valor_fraude"] += m["valor"]
                agg["fraudes_alertadas"] += int(alerta)
                agg["valor_fraude_alertado"] += m["valor"] * alerta
                agg["challenger_fraudes_alertadas"] += int(m.get("challenger") not in (None, "aprovar"))
        p = st.r.pipeline()
        for k, v in agg.items():
            (p.hincrbyfloat if isinstance(v, float) else p.hincrby)("fraud:labels:maduros_agg", k, v)
        p.zremrangebyscore("fraud:labels:pendentes", 0, relogio)
        p.execute()
    a = {k: float(v) for k, v in (st.r.hgetall("fraud:labels:maduros_agg") or {}).items()}
    n_mad = int(a.get("n", 0))
    pendentes = st.r.zcard("fraud:labels:pendentes")
    perf = None
    if n_mad and a.get("fraudes", 0) > 0:
        perf = {"n_maduro": n_mad, "fraudes_maduras": int(a["fraudes"]),
                "recall": a["fraudes_alertadas"] / a["fraudes"],
                "precisao": a["fraudes_alertadas"] / a["alertas"] if a.get("alertas") else None,
                "recall_valor": a["valor_fraude_alertado"] / a["valor_fraude"] if a.get("valor_fraude") else None,
                "challenger_recall_hipotetico": a["challenger_fraudes_alertadas"] / a["fraudes"],
                "aviso": "métricas só da safra madura (rótulo liberado após 30 dias virtuais); challenger com cortes próprios de mesma taxa de alerta"}
    drift = {k: psi(ref[k], np.array(janela[k], dtype=float)) for k in ref}
    vc = pd.Series(acoes).value_counts(normalize=True).to_dict() if acoes else {}
    mon = {"relogio_virtual": datetime.fromtimestamp(relogio, tz=timezone.utc).isoformat(), "eventos_processados": cursor,
           "total_periodo_teste": total, "deriva_simulada_valor": deriva,
           "psi": {k: (round(v, 4) if v is not None else None) for k, v in drift.items()},
           "psi_regra": "PSI < 0,1 estável; 0,1 a 0,25 atenção; > 0,25 investigar. Heurística, não prova de concept drift.",
           "distribuicao_decisoes_janela": {k: round(v, 4) for k, v in vc.items()},
           "rotulos": {"maduros": n_mad, "pendentes": int(pendentes),
                       "cobertura": round(n_mad / max(n_mad + pendentes, 1), 4)},
           "desempenho_safra_madura": perf, "atualizado_em": time.time()}
    st.r.set("fraud:monitoring", json.dumps(mon))
    st.r.set("fraud:replay:status", json.dumps({"status": "rodando", "cursor": cursor, "total": total}))


if __name__ == "__main__":
    main()
