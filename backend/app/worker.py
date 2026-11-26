"""Worker assíncrono: consome o Redis Streams, atualiza o histórico do cartão e persiste no BigQuery.

Garantias (e limites) documentados:
- Consumer group + ACK SÓ depois da persistência: se o worker cair, a mensagem fica pendente e é retomada (XAUTOCLAIM).
- Idempotência: SADD fraud:persisted:{tx_id}; evento repetido não atualiza o perfil duas vezes.
- Atualização do perfil com WATCH/MULTI (otimista): sem sobrescrever escrita concorrente.
- Semântica de histórico: transações aprovadas e autenticadas entram nas features de velocidade;
  as retidas para investigação NÃO entram (não foram autorizadas) e são contadas à parte em fraud:tentativas_retidas.
- BigQuery: lotes via load job (sem custo de streaming insert). Sem credencial, roda em modo degradado ROTULADO
  (eventos ficam no Redis e o status mostra "BigQuery desativado").
"""
from __future__ import annotations

import json
import os
import socket
import time
from datetime import datetime, timezone

import redis

from .features import atualizar_perfil
from .store import GRUPO, STREAM, Store, k_perfil

LOTE = int(os.environ.get("WORKER_BATCH", "200"))
INTERVALO_BQ_S = float(os.environ.get("BQ_FLUSH_S", "15"))
NOME = f"worker-{socket.gethostname()}"


class Persistencia:
    def __init__(self):
        self.ativo = os.environ.get("BQ_ENABLED", "1") == "1" and bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"))
        self.erro = None
        if self.ativo:
            from google.cloud import bigquery
            self.bq = bigquery
            self.cli = bigquery.Client(project=os.environ["GCP_PROJECT"], location=os.environ.get("GCP_LOCATION", "US"))
            self.ds = f'{os.environ["GCP_PROJECT"]}.{os.environ.get("BQ_DATASET", "fraud_intelligence")}'

    def gravar(self, eventos: list[dict]) -> dict:
        if not eventos:
            return {"linhas": 0}
        agora = datetime.now(timezone.utc).isoformat()
        pred = [{"tx_id": e["tx_id"], "card_key": e["card_key"],
                 "event_ts": datetime.fromtimestamp(e["tx"]["ts"], tz=timezone.utc).isoformat(),
                 "amount_usd": e["tx"]["amount_usd"], "merchant": e["tx"]["merchant"], "category": e["tx"]["category"],
                 "raw_score": e["raw_score"], "calibrated_score": e["calibrated_score"], "challenger_score": e.get("challenger_score"),
                 "model_version": e["model_version"], "feature_version": "v1", "features": json.dumps(e["features"]),
                 "origem": e["origem"], "latency_ms": e.get("latency_ms"), "processed_at": agora} for e in eventos]
        dec = [{"tx_id": e["tx_id"], "decision": e["decision"], "challenger_decision": e.get("challenger_decision"),
                "policy_version": e["policy_version"], "t_auth": e["t_auth"], "t_review": e["t_review"],
                "reasons": json.dumps(e["reasons"]), "origem": e["origem"], "decided_at": agora} for e in eventos]
        t0 = time.time()
        if self.ativo:
            cfg = self.bq.LoadJobConfig(write_disposition="WRITE_APPEND", source_format="NEWLINE_DELIMITED_JSON")
            for tabela, linhas in (("gold_predictions", pred), ("gold_decisions", dec)):
                self.cli.load_table_from_json(linhas, f"{self.ds}.{tabela}", job_config=cfg).result(timeout=120)
        return {"linhas": len(eventos), "segundos": round(time.time() - t0, 2), "destino": "BigQuery" if self.ativo else "desativado"}


def aplicar_no_perfil(store: Store, e: dict):
    if e["decision"] == "investigar":
        store.r.incr("fraud:tentativas_retidas")
        return "retida (fora do histórico)"
    chave = k_perfil(e["card_key"])
    for _ in range(5):
        with store.r.pipeline() as p:
            try:
                p.watch(chave)
                perfil, extra = store.perfil(e["card_key"])
                if perfil is None:
                    p.unwatch()
                    return "perfil ausente"
                atualizar_perfil(perfil, e["tx"])
                extra = {k: v for k, v in (extra or {}).items() if k not in ("card_key", "home_lat", "home_long", "total_tx", "merchants_vistos", "ultimas", "snapshot_ts")}
                extra["atualizado_em"] = time.time()
                p.multi()
                p.set(chave, Store.serializar(perfil, extra))
                p.execute()
                return "aplicada"
            except redis.WatchError:
                continue
    raise RuntimeError("conflito persistente ao atualizar perfil")


class Worker:
    """Um ciclo = ler mensagens, aplicar no perfil, persistir em lote e só então dar ACK."""

    def __init__(self, store: Store, pers: Persistencia, nome: str = NOME):
        self.store, self.pers, self.nome = store, pers, nome
        self.buffer, self.ids, self.ultimo_flush = [], [], time.time()
        try:
            store.r.xgroup_create(STREAM, GRUPO, id="0", mkstream=True)
        except redis.ResponseError:
            pass

    def ciclo(self, bloquear_ms: int = 2000, forcar_flush: bool = False, ocioso_ms: int = 60000):
        store = self.store
        store.r.set("fraud:worker:heartbeat", time.time())
        try:  # retoma mensagens órfãs (worker anterior caiu antes do ACK)
            _, orfas, _ = store.r.xautoclaim(STREAM, GRUPO, self.nome, min_idle_time=ocioso_ms, start_id="0-0", count=LOTE)
        except Exception:
            orfas = []
        novas = store.r.xreadgroup(GRUPO, self.nome, {STREAM: ">"}, count=LOTE, block=bloquear_ms) or []
        msgs = list(orfas) + [m for _, lote in novas for m in lote]
        for msg_id, campos in msgs:
            e = json.loads(campos["dados"])
            if msg_id in self.ids:
                continue  # já está no lote em memória aguardando o BigQuery
            if not store.r.sadd("fraud:persisted_ids", e["tx_id"]):
                # perfil já aplicado antes (reentrega ou retry): não reaplica; só garante a persistência
                if (store.r.get(f"fraud:status:{e['tx_id']}") or "").startswith(("persistido", "processado")):
                    store.r.xack(STREAM, GRUPO, msg_id)
                    continue
                e["perfil"] = "já aplicada (reentrega)"
            else:
                try:
                    e["perfil"] = aplicar_no_perfil(store, e)
                except Exception as exc:
                    store.r.srem("fraud:persisted_ids", e["tx_id"])
                    print("erro perfil", exc, flush=True)
                    continue
            self.buffer.append(e)
            self.ids.append(msg_id)
        if self.buffer and (forcar_flush or len(self.buffer) >= LOTE or time.time() - self.ultimo_flush >= INTERVALO_BQ_S):
            self.flush()
        return len(msgs)

    def flush(self):
        store, pers = self.store, self.pers
        try:
            info = pers.gravar(self.buffer)
        except Exception as exc:
            # sem ACK: as mensagens continuam pendentes e serão retomadas; o perfil já foi aplicado (idempotente)
            store.r.set("fraud:bq:last_sync", json.dumps({"status": "erro", "quando": time.time(), "erro": str(exc)[:200]}))
            print("erro BigQuery", exc, flush=True)
            return False
        p = store.r.pipeline()
        for e, msg_id in zip(self.buffer, self.ids):
            p.xack(STREAM, GRUPO, msg_id)
            p.set(f"fraud:status:{e['tx_id']}", "persistido" if pers.ativo else "processado (BigQuery desativado)", ex=7 * 86400)
            p.set(f"fraud:persist_info:{e['tx_id']}", json.dumps({"perfil": e["perfil"], "persistido_em": time.time(),
                                                                 "atraso_s": round(time.time() - e["recebido_em"], 2),
                                                                 "destino": info.get("destino")}), ex=7 * 86400)
        p.set("fraud:bq:last_sync", json.dumps({"status": "ok" if pers.ativo else "desativado", "quando": time.time(), **info}))
        p.incrby("fraud:bq:linhas_total", info["linhas"])
        p.execute()
        self.buffer, self.ids, self.ultimo_flush = [], [], time.time()
        return True


def main():
    store = Store(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), timeout=15)  # maior que o BLOCK do XREADGROUP
    pers = Persistencia()
    w = Worker(store, pers)
    print(f"{NOME} iniciado | BigQuery {'ativo' if pers.ativo else 'DESATIVADO (modo degradado rotulado)'}", flush=True)
    while True:
        try:
            w.ciclo()
        except (redis.ConnectionError, redis.TimeoutError) as exc:
            print("Redis indisponível", exc, flush=True)
            time.sleep(3)


if __name__ == "__main__":
    main()
