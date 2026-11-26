"""Camada Redis: perfis (feature store online), merchants, idempotência, stream de eventos e métricas."""
from __future__ import annotations

import json
import time

import redis

from .features import Perfil

STREAM = "fraud:transactions"
GRUPO = "persistencia"


def k_perfil(card):
    return f"fraud:profile:{card}"


def k_merchant(m):
    return f"fraud:merchant:{m}"


class Store:
    def __init__(self, url: str, timeout: float = 2.0):
        self.r = redis.Redis.from_url(url, decode_responses=True, socket_timeout=timeout, socket_connect_timeout=2)

    # ---------------- perfis
    def perfil(self, card: str) -> tuple[Perfil | None, dict | None]:
        bruto = self.r.get(k_perfil(card))
        if bruto is None:
            return None, None
        d = json.loads(bruto)
        p = Perfil(d["card_key"], d["home_lat"], d["home_long"], d["total_tx"], set(d["merchants_vistos"]), d["ultimas"], d["snapshot_ts"])
        return p, d

    @staticmethod
    def serializar(p: Perfil, extra: dict | None = None) -> str:
        d = {"card_key": p.card_key, "home_lat": p.home_lat, "home_long": p.home_long, "total_tx": p.total_tx,
             "merchants_vistos": sorted(p.merchants_vistos), "ultimas": p.ultimas, "snapshot_ts": p.snapshot_ts}
        d.update(extra or {})
        return json.dumps(d)

    def merchant(self, m: str) -> dict | None:
        bruto = self.r.get(k_merchant(m))
        return json.loads(bruto) if bruto else None

    # ---------------- idempotência e eventos
    def resposta_existente(self, tx_id: str) -> dict | None:
        bruto = self.r.get(f"fraud:tx:{tx_id}")
        return json.loads(bruto) if bruto else None

    def reservar_tx(self, tx_id: str) -> bool:
        """True se este tx_id ainda não foi processado (SET NX). Evita efeito duplicado em retry."""
        return bool(self.r.set(f"fraud:txlock:{tx_id}", "1", nx=True, ex=7 * 86400))

    def guardar_resposta(self, tx_id: str, resp: dict):
        self.r.set(f"fraud:tx:{tx_id}", json.dumps(resp, default=str), ex=7 * 86400)

    def publicar(self, evento: dict) -> str:
        return self.r.xadd(STREAM, {"dados": json.dumps(evento, default=str)}, maxlen=200000, approximate=True)

    def status_evento(self, tx_id: str) -> str | None:
        return self.r.get(f"fraud:status:{tx_id}")

    # ---------------- métricas operacionais
    def registrar_latencia(self, ms: float, decisao: str, origem: str):
        p = self.r.pipeline()
        p.lpush(f"fraud:lat:{origem}", round(ms, 3))
        p.ltrim(f"fraud:lat:{origem}", 0, 4999)
        p.hincrby(f"fraud:count:{origem}", decisao, 1)
        p.execute()

    def limitar(self, chave: str, limite: int, janela_s: int = 60) -> bool:
        k = f"fraud:rl:{chave}:{int(time.time() // janela_s)}"
        n = self.r.incr(k)
        if n == 1:
            self.r.expire(k, janela_s + 5)
        return n <= limite
