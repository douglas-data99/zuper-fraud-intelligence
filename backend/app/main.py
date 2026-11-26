"""API de decisão antifraude (FastAPI).

Caminho síncrono: valida -> lê perfil no Redis -> calcula features -> modelo em memória -> calibra -> decide.
Nada de BigQuery no caminho síncrono. A persistência é assíncrona (Redis Streams -> worker -> BigQuery).
"""
from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from .features import Perfil, calcular_online
from .scoring import Modelo
from .store import GRUPO, STREAM, Store, k_perfil

BUNDLE = os.environ.get("BUNDLE_DIR", "/app/bundle")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
ORIGENS = [o for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o]
LIMITE_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "120"))
DESLOCAMENTOS = {"perto_de_casa": (0.02, 0.02), "cidade_vizinha": (0.45, 0.35), "outro_estado": (6.0, -9.0)}

app = FastAPI(title="Zuper Fraud Intelligence API", version="1.0.0",
              description="Projeto de portfólio com dados sintéticos públicos (Sparkov). Não é um sistema bancário real.")
app.add_middleware(CORSMiddleware, allow_origins=ORIGENS, allow_methods=["GET", "POST"], allow_headers=["*"])

MODELO = Modelo(BUNDLE)
STORE = Store(REDIS_URL)
INICIO = time.time()


# ---------------------------------------------------------------- contratos
class TransacaoIn(BaseModel):
    tx_id: str | None = Field(None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9\-_]+$")
    card_key: str = Field(..., min_length=16, max_length=16, pattern=r"^[0-9a-f]{16}$")
    amount_usd: float = Field(..., gt=0, le=30000)
    merchant: str = Field(..., min_length=2, max_length=80)
    hora: int | None = Field(None, ge=0, le=23, description="Hora do dia no relógio virtual; se ausente, usa o relógio atual")
    local: Literal["perto_de_casa", "cidade_vizinha", "outro_estado"] = "perto_de_casa"

    @field_validator("merchant")
    @classmethod
    def sem_controle(cls, v):
        if any(ord(c) < 32 for c in v):
            raise ValueError("caractere inválido")
        return v


def erro(status: int, codigo: str, msg: str):
    raise HTTPException(status_code=status, detail={"codigo": codigo, "mensagem": msg})


def limitar(request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    try:
        ok = STORE.limitar(ip, LIMITE_MIN)
    except Exception:
        ok = True  # o próprio Redis fora do ar é tratado no endpoint
    if not ok:
        erro(429, "limite", f"máximo de {LIMITE_MIN} requisições por minuto")


def admin(authorization: str = Header("")):
    if not ADMIN_TOKEN or authorization != f"Bearer {ADMIN_TOKEN}":
        erro(401, "nao_autorizado", "endpoint protegido")


@app.exception_handler(Exception)
async def falha_geral(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": {"codigo": "erro_interno", "mensagem": "falha interna; nenhuma decisão foi tomada"}})


# ---------------------------------------------------------------- núcleo
def relogio_virtual() -> int:
    v = STORE.r.get("fraud:clock")
    return int(v) if v else 0


def montar_tx(body: TransacaoIn, perfil: Perfil, minfo: dict) -> dict:
    base = max(perfil.snapshot_ts, relogio_virtual()) + 60
    if body.hora is not None:
        dia = datetime.fromtimestamp(base, tz=timezone.utc).replace(hour=body.hora, minute=0, second=0)
        ts = int(dia.timestamp())
        if ts < base:
            ts += 86400
    else:
        ts = base
    dlat, dlon = DESLOCAMENTOS[body.local]
    return {"ts": ts, "amount_usd": float(body.amount_usd), "merchant": body.merchant, "category": minfo["categoria"],
            "merch_lat": perfil.home_lat + dlat, "merch_long": perfil.home_long + dlon}


def processar(body: TransacaoIn, gravar: bool, origem: str) -> dict:
    t0 = time.perf_counter()
    etapas = [{"etapa": "requisição recebida", "ms": 0.0}]
    tx_id = body.tx_id or uuid.uuid4().hex
    if gravar:
        anterior = STORE.resposta_existente(tx_id)
        if anterior:
            anterior["idempotente"] = True
            return anterior
    try:
        perfil, bruto = STORE.perfil(body.card_key)
        minfo = STORE.merchant(body.merchant)
    except Exception:
        erro(503, "feature_store_indisponivel", "Redis indisponível: decisão não tomada (sem aprovação por padrão)")
    etapas.append({"etapa": "lookup Redis (perfil + loja)", "ms": round((time.perf_counter() - t0) * 1000, 3)})
    if perfil is None:
        erro(404, "perfil_desconhecido", "cartão não encontrado na feature store")
    if minfo is None:
        erro(422, "loja_desconhecida", "estabelecimento fora do catálogo conhecido")
    tx = montar_tx(body, perfil, minfo)
    feat = calcular_online(perfil, tx, minfo["merchant_distinct_cards_30d"])
    etapas.append({"etapa": "features calculadas", "ms": round((time.perf_counter() - t0) * 1000, 3)})
    res = MODELO.pontuar(feat, com_motivos=True, shadow=True)
    etapas.append({"etapa": "inferência + calibração", "ms": round((time.perf_counter() - t0) * 1000, 3)})
    etapas.append({"etapa": "decisão aplicada", "ms": round((time.perf_counter() - t0) * 1000, 3)})
    frescor = tx["ts"] - perfil.snapshot_ts
    resposta = {
        "transaction_id": tx_id,
        "event_time": datetime.fromtimestamp(tx["ts"], tz=timezone.utc).isoformat(),
        "raw_score": round(res["raw_score"], 6),
        "calibrated_score": round(res["calibrated_score"], 6),
        "decision": res["decision"],
        "policy_version": MODELO.politica.versao,
        "cortes": {"t_auth": MODELO.politica.t_auth, "t_review": MODELO.politica.t_review},
        "model_version": MODELO.versao,
        "feature_snapshot_time": datetime.fromtimestamp(perfil.snapshot_ts, tz=timezone.utc).isoformat(),
        "feature_status": "ok" if frescor >= 0 else "perfil_mais_novo_que_evento",
        "features": {k: (None if v is None else (round(v, 4) if isinstance(v, float) else v)) for k, v in feat.items()},
        "reasons": res["reasons"],
        "shadow": res.get("shadow"),
        "modo": "transacao" if gravar else "what-if (sem gravação)",
    }
    if gravar:
        if not STORE.reservar_tx(tx_id):
            anterior = STORE.resposta_existente(tx_id)
            if anterior:
                anterior["idempotente"] = True
                return anterior
            erro(409, "em_processamento", "transação com este id já está em processamento")
        evento = {"tx_id": tx_id, "card_key": body.card_key, "tx": tx, "features": resposta["features"], "origem": origem,
                  "raw_score": res["raw_score"], "calibrated_score": res["calibrated_score"], "decision": res["decision"],
                  "challenger_score": (res.get("shadow") or {}).get("score"),
                  "challenger_decision": (res.get("shadow") or {}).get("decisao_hipotetica"),
                  "policy_version": MODELO.politica.versao, "t_auth": MODELO.politica.t_auth, "t_review": MODELO.politica.t_review,
                  "model_version": MODELO.versao, "reasons": res["reasons"]["itens"], "recebido_em": time.time()}
        ms_ate_aqui = (time.perf_counter() - t0) * 1000
        evento["latency_ms"] = round(ms_ate_aqui, 3)
        STORE.publicar(evento)
        STORE.r.set(f"fraud:status:{tx_id}", "publicado", ex=7 * 86400)
        etapas.append({"etapa": "evento publicado (Redis Streams)", "ms": round((time.perf_counter() - t0) * 1000, 3)})
        resposta["event_status"] = "publicado; persistência no BigQuery pendente (assíncrona)"
    else:
        resposta["event_status"] = "não publicado (what-if)"
    total = (time.perf_counter() - t0) * 1000
    resposta["latency_ms"] = round(total, 3)
    resposta["trilha"] = etapas
    try:
        STORE.registrar_latencia(total, res["decision"], origem if gravar else "whatif")
    except Exception:
        pass
    if gravar:
        STORE.guardar_resposta(tx_id, resposta)
    return resposta


# ---------------------------------------------------------------- endpoints públicos
@app.get("/health")
def health():
    try:
        redis_ok = bool(STORE.r.ping())
    except Exception:
        redis_ok = False
    return {"status": "ok" if redis_ok else "degradado", "redis": redis_ok, "modelo": MODELO.versao,
            "politica": MODELO.politica.versao, "uptime_s": round(time.time() - INICIO)}


@app.get("/profiles", dependencies=[Depends(limitar)])
def perfis(limite: int = 40):
    lista = STORE.r.get("fraud:card_list")
    if not lista:
        erro(503, "feature_store_vazia", "perfis ainda não carregados no Redis")
    return json.loads(lista)[: max(1, min(limite, 200))]


@app.get("/profiles/{card_key}", dependencies=[Depends(limitar)])
def perfil(card_key: str):
    p, d = STORE.perfil(card_key)
    if p is None:
        erro(404, "perfil_desconhecido", "cartão não encontrado")
    valores = [h["amount"] for h in p.ultimas]
    cats = {}
    for h in p.ultimas:
        cats[h["category"]] = cats.get(h["category"], 0) + 1
    return {"card_key": card_key, "snapshot_time": datetime.fromtimestamp(p.snapshot_ts, tz=timezone.utc).isoformat(),
            "historico_total": p.total_tx, "lojas_conhecidas": len(p.merchants_vistos),
            "ultimos_30d": {"transacoes": len(valores), "gasto_total": round(sum(valores), 2),
                            "media": round(float(np.mean(valores)), 2) if valores else None,
                            "desvio": round(float(np.std(valores, ddof=1)), 2) if len(valores) > 1 else None,
                            "por_categoria": dict(sorted(cats.items(), key=lambda x: -x[1]))},
            "ultima_transacao": p.ultimas[-1] if p.ultimas else None,
            "historico_recente": p.ultimas[-25:], "categoria_mais_comum": d.get("categoria_mais_comum"),
            "ticket_medio_historico": d.get("ticket_medio_historico"),
            "lojas_sugeridas": d.get("lojas_sugeridas", [])}


@app.get("/merchants", dependencies=[Depends(limitar)])
def merchants(categoria: str | None = None):
    lista = json.loads(STORE.r.get("fraud:merchant_list") or "[]")
    return [m for m in lista if categoria in (None, m["categoria"])]


@app.get("/scenarios", dependencies=[Depends(limitar)])
def cenarios():
    return json.loads(STORE.r.get("fraud:scenarios") or "[]")


@app.post("/transactions/score", dependencies=[Depends(limitar)])
def score(body: TransacaoIn):
    """What-if: calcula score e decisão SEM gravar evento nem alterar o histórico."""
    return processar(body, gravar=False, origem="whatif")


@app.post("/transactions", dependencies=[Depends(limitar)])
def transacao(body: TransacaoIn):
    """Transação simulada: decide, publica evento idempotente e o worker atualiza histórico e BigQuery."""
    if not body.tx_id:
        erro(422, "tx_id_obrigatorio", "envie um tx_id para garantir idempotência em retry")
    return processar(body, gravar=True, origem="interativo")


@app.get("/transactions/{tx_id}", dependencies=[Depends(limitar)])
def status_transacao(tx_id: str):
    resp = STORE.resposta_existente(tx_id)
    if not resp:
        erro(404, "desconhecida", "transação não encontrada")
    resp["event_status_atual"] = STORE.status_evento(tx_id) or "desconhecido"
    persist = STORE.r.get(f"fraud:persist_info:{tx_id}")
    resp["persistencia"] = json.loads(persist) if persist else None
    return resp


def percentis(lista):
    if not lista:
        return {"p50": None, "p95": None, "p99": None, "n": 0}
    a = np.array(lista, dtype=float)
    return {"p50": round(float(np.percentile(a, 50)), 2), "p95": round(float(np.percentile(a, 95)), 2),
            "p99": round(float(np.percentile(a, 99)), 2), "n": int(len(a))}


@app.get("/metrics", dependencies=[Depends(limitar)])
def metricas():
    r = STORE.r
    out = {"latencia_ms": {}, "decisoes": {}}
    for origem in ("interativo", "replay", "whatif"):
        out["latencia_ms"][origem] = percentis(r.lrange(f"fraud:lat:{origem}", 0, -1))
        out["decisoes"][origem] = {k: int(v) for k, v in (r.hgetall(f"fraud:count:{origem}") or {}).items()}
    mon = r.get("fraud:monitoring")
    out["monitoramento"] = json.loads(mon) if mon else None
    out["modelo_teste_historico"] = MODELO.metricas
    return out


@app.get("/models")
def modelos():
    return {"champion": {"versao": MODELO.versao, "nome": MODELO.schema.get("champion"), "treinado_em": MODELO.schema.get("treinado_em"),
                         "dataset_sha256": MODELO.schema.get("dataset_sha256"), "git": MODELO.schema.get("git"),
                         "calibracao": MODELO.cal_tipo, "best_iteration": MODELO.schema.get("best_iteration")},
            "challenger": {"nome": MODELO.schema.get("challenger"), "modo": "shadow (nunca altera a decisão)",
                           "ativo": MODELO.challenger is not None},
            "politica": {"versao": MODELO.politica.versao, "t_auth": MODELO.politica.t_auth, "t_review": MODELO.politica.t_review,
                         "premissas": MODELO.policy_cfg["acoes"]},
            "features": MODELO.colunas}


@app.get("/architecture/status")
def arquitetura():
    st = {"api": {"status": "ok", "modelo_carregado": MODELO.versao}}
    try:
        r = STORE.r
        r.ping()
        info = {"status": "ok", "perfis": int(r.get("fraud:n_perfis") or 0)}
        try:
            grupos = r.xinfo_groups(STREAM)
            g = next((x for x in grupos if x["name"] == GRUPO), None)
            info_stream = {"tamanho": r.xlen(STREAM), "pendentes_sem_ack": g["pending"] if g else None,
                           "lag": g.get("lag") if g else None}
        except Exception:
            info_stream = {"tamanho": 0, "pendentes_sem_ack": None, "lag": None}
        hb = r.get("fraud:worker:heartbeat")
        st["redis"] = info
        st["stream"] = info_stream
        st["worker"] = {"ultimo_sinal_s": round(time.time() - float(hb), 1) if hb else None,
                        "status": "ok" if hb and time.time() - float(hb) < 30 else "sem sinal"}
        bq = r.get("fraud:bq:last_sync")
        st["bigquery"] = json.loads(bq) if bq else {"status": "sem sincronização ainda"}
        rp = r.get("fraud:replay:status")
        st["replay"] = json.loads(rp) if rp else {"status": "parado"}
        st["relogio_virtual"] = datetime.fromtimestamp(relogio_virtual(), tz=timezone.utc).isoformat() if relogio_virtual() else None
    except Exception:
        st["redis"] = {"status": "indisponível"}
    return st


# ---------------------------------------------------------------- endpoints protegidos
@app.post("/admin/replay", dependencies=[Depends(admin)])
def replay_comando(acao: Literal["iniciar", "pausar"], eventos_por_segundo: float = 20.0, deriva_valor: float = 1.0):
    STORE.r.set("fraud:replay:comando", json.dumps({"acao": acao, "eps": eventos_por_segundo, "deriva_valor": deriva_valor}))
    return {"ok": True, "acao": acao}


@app.post("/admin/model/rollback", dependencies=[Depends(admin)])
def rollback():
    return {"ok": False, "mensagem": "apenas uma versão aprovada publicada; rollback documentado em docs/architecture.md"}
