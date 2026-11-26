"""Features: a MESMA definição usada offline (BigQuery, sql/gold) e online (API, a partir do Redis).

Regras de janela (iguais ao SQL `RANGE BETWEEN W PRECEDING AND 1 PRECEDING`):
  uma transação passada h entra na janela W da transação atual t se  t - W <= h.ts <= t - 1.
  Logo, a própria transação e as do mesmo segundo nunca entram.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from statistics import mean, stdev

import numpy as np
import pandas as pd

R_TERRA_KM = 6371.0088
JANELAS = {"30min": 1800, "24h": 86400, "7d": 604800, "30d": 2592000}

CATEGORIAS = [
    "entertainment", "food_dining", "gas_transport", "grocery_net", "grocery_pos", "health_fitness", "home",
    "kids_pets", "misc_net", "misc_pos", "personal_care", "shopping_net", "shopping_pos", "travel",
]
TRANSACIONAIS = ["amount_usd", "log_amount", "hour", "weekday", "distance_to_merchant_km"]
COMPORTAMENTAIS = [
    "avg_amount_7d", "avg_amount_30d", "std_amount_30d", "amount_vs_avg_30d",
    "tx_count_30min", "tx_count_24h", "tx_count_7d", "tx_count_30d", "sum_amount_24h",
    "time_since_last_tx_s", "is_new_merchant", "category_frequency_30d",
    "merchant_distinct_cards_30d", "profile_history_count",
]
ONE_HOT = [f"cat_{c}" for c in CATEGORIAS]


def colunas(experimento: str) -> list[str]:
    base = TRANSACIONAIS + ONE_HOT
    return base if experimento == "A" else base + COMPORTAMENTAIS


def vetorizar(df: pd.DataFrame, experimento: str = "B") -> pd.DataFrame:
    """DataFrame de features cruas (gold ou online) -> matriz numérica na ordem fixa do modelo."""
    X = pd.DataFrame(index=df.index)
    for c in TRANSACIONAIS + (COMPORTAMENTAIS if experimento == "B" else []):
        if c == "log_amount" and c not in df:
            X[c] = np.log1p(df["amount_usd"].astype(float))
        else:
            X[c] = pd.to_numeric(df[c], errors="coerce").astype(float)
    cat = df["category"].astype(str)
    for c in CATEGORIAS:
        X[f"cat_{c}"] = (cat == c).astype(float)
    return X[colunas(experimento)]


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_TERRA_KM * math.asin(min(1.0, math.sqrt(a)))


@dataclass
class Perfil:
    """Estado do cartão guardado no Redis (nunca enviado pelo navegador)."""
    card_key: str
    home_lat: float
    home_long: float
    total_tx: int = 0                      # transações anteriores (histórico inteiro)
    merchants_vistos: set = field(default_factory=set)
    ultimas: list = field(default_factory=list)   # transações dos últimos 30 dias: dicts {ts, amount, merchant, category}
    snapshot_ts: int = 0                   # até quando o histórico está atualizado (epoch s)


def calcular_online(perfil: Perfil, tx: dict, merchant_distinct_cards_30d: int) -> dict:
    """Features da transação atual a partir do perfil. tx: {ts, amount_usd, merchant, category, merch_lat, merch_long}."""
    t = int(tx["ts"])
    hist = [h for h in perfil.ultimas if h["ts"] <= t - 1]
    def janela(seg):
        return [h for h in hist if t - seg <= h["ts"]]
    w30m, w24h, w7d, w30d = (janela(JANELAS[k]) for k in ("30min", "24h", "7d", "30d"))
    a7 = [h["amount"] for h in w7d]
    a30 = [h["amount"] for h in w30d]
    avg30 = mean(a30) if a30 else None
    dt = datetime.fromtimestamp(t, tz=timezone.utc)
    ts_anteriores = [h["ts"] for h in hist]
    feat = {
        "amount_usd": float(tx["amount_usd"]),
        "log_amount": math.log1p(float(tx["amount_usd"])),
        "category": tx["category"],
        "hour": dt.hour,
        "weekday": dt.isoweekday() % 7,  # 0 = domingo, igual ao SQL
        "distance_to_merchant_km": haversine_km(perfil.home_lat, perfil.home_long, tx["merch_lat"], tx["merch_long"]),
        "avg_amount_7d": mean(a7) if a7 else None,
        "avg_amount_30d": avg30,
        "std_amount_30d": stdev(a30) if len(a30) >= 2 else None,
        "amount_vs_avg_30d": (float(tx["amount_usd"]) / avg30) if avg30 else None,
        "tx_count_30min": len(w30m),
        "tx_count_24h": len(w24h),
        "tx_count_7d": len(w7d),
        "tx_count_30d": len(w30d),
        "sum_amount_24h": float(sum(h["amount"] for h in w24h)),
        "time_since_last_tx_s": (t - max(ts_anteriores)) if ts_anteriores else None,
        "is_new_merchant": 0 if tx["merchant"] in perfil.merchants_vistos else 1,
        "category_frequency_30d": (sum(1 for h in w30d if h["category"] == tx["category"]) / len(w30d)) if w30d else None,
        "merchant_distinct_cards_30d": int(merchant_distinct_cards_30d),
        # histórico inteiro anterior: transações antigas (fora da lista de 30 dias) + as da lista anteriores a t
        "profile_history_count": perfil.total_tx - sum(1 for h in perfil.ultimas if h["ts"] > t - 1),
    }
    return feat


def atualizar_perfil(perfil: Perfil, tx: dict) -> Perfil:
    """Incorpora uma transação ao perfil (depois da decisão) e descarta o que saiu da janela de 30 dias."""
    t = int(tx["ts"])
    perfil.ultimas.append({"ts": t, "amount": float(tx["amount_usd"]), "merchant": tx["merchant"], "category": tx["category"]})
    perfil.ultimas.sort(key=lambda h: h["ts"])
    limite = t - JANELAS["30d"]
    perfil.ultimas = [h for h in perfil.ultimas if h["ts"] >= limite]
    perfil.total_tx += 1
    perfil.merchants_vistos.add(tx["merchant"])
    perfil.snapshot_ts = max(perfil.snapshot_ts, t)
    return perfil
