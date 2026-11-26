"""API + Redis + Streams + worker com um Redis de TESTE real (docker, porta 6390).

Cobre: 200/422/404, what-if sem escrita, idempotência, publicação + consumo + ACK, recuperação após falha
do worker, falha explícita sem Redis, rótulo atrasado, drift (PSI) e endpoints protegidos.
"""
import json
import os
from pathlib import Path

import numpy as np
import pytest
import redis

RAIZ = Path(__file__).resolve().parents[2]
SERVING = RAIZ / "data" / "serving"
URL = os.environ["REDIS_URL"]


def redis_ok():
    try:
        return redis.Redis.from_url(URL, socket_connect_timeout=1).ping()
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not redis_ok() or not SERVING.exists(), reason="Redis de teste (porta 6390) ou snapshot ausente")


@pytest.fixture(scope="module")
def ambiente():
    r = redis.Redis.from_url(URL, decode_responses=True)
    r.flushdb()
    from app import loader
    st, perfis, merchants, por_cat = loader.carregar(str(SERVING), URL)
    os.environ["BUNDLE_DIR"] = str(RAIZ / "artifacts" / "model_bundle")
    loader.escolher_cenarios(st, perfis, merchants, por_cat)
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app), r, perfis, merchants


def corpo(perfis, merchants, **extra):
    ck = next(iter(perfis))
    loja = perfis[ck]["lojas_sugeridas"][0] if perfis[ck].get("lojas_sugeridas") else next(iter(merchants))
    return {"card_key": ck, "merchant": loja, "amount_usd": 42.5, "hora": 14, "local": "perto_de_casa", **extra}


def test_health(ambiente):
    c, *_ = ambiente
    j = c.get("/health").json()
    assert j["status"] == "ok" and j["redis"] is True


def test_score_valido_sem_escrita(ambiente):
    c, r, perfis, merchants = ambiente
    antes = r.xlen("fraud:transactions") if r.exists("fraud:transactions") else 0
    resp = c.post("/transactions/score", json=corpo(perfis, merchants))
    assert resp.status_code == 200
    j = resp.json()
    for campo in ("transaction_id", "raw_score", "calibrated_score", "decision", "policy_version", "model_version",
                  "feature_snapshot_time", "feature_status", "latency_ms", "reasons", "event_status"):
        assert campo in j
    assert j["decision"] in ("aprovar", "autenticar", "investigar")
    assert j["reasons"]["unidade"].startswith("log-odds")
    depois = r.xlen("fraud:transactions") if r.exists("fraud:transactions") else 0
    assert depois == antes        # what-if não publica evento


@pytest.mark.parametrize("ruim", [{"amount_usd": -5}, {"amount_usd": 0}, {"card_key": "nao-hex!"}, {"hora": 25}, {"local": "lua"}])
def test_entrada_invalida_422(ambiente, ruim):
    c, _, perfis, merchants = ambiente
    assert c.post("/transactions/score", json=corpo(perfis, merchants, **ruim)).status_code == 422


def test_cartao_desconhecido_404_e_loja_desconhecida_422(ambiente):
    c, _, perfis, merchants = ambiente
    assert c.post("/transactions/score", json=corpo(perfis, merchants, card_key="0" * 16)).status_code == 404
    assert c.post("/transactions/score", json=corpo(perfis, merchants, merchant="Loja Inexistente")).status_code == 422


def test_transacao_exige_id_e_e_idempotente(ambiente):
    c, r, perfis, merchants = ambiente
    assert c.post("/transactions", json=corpo(perfis, merchants)).status_code == 422
    b = corpo(perfis, merchants, tx_id="teste-idem-0001")
    antes = r.xlen("fraud:transactions")
    j1 = c.post("/transactions", json=b).json()
    j2 = c.post("/transactions", json=b).json()
    assert r.xlen("fraud:transactions") == antes + 1      # retry não duplica o evento
    assert j2.get("idempotente") is True and j1["calibrated_score"] == j2["calibrated_score"]


def test_stream_worker_ack_e_atualizacao_do_perfil(ambiente):
    c, r, perfis, merchants = ambiente
    from app.store import GRUPO, STREAM, Store
    from app.worker import Persistencia, Worker
    os.environ["BQ_ENABLED"] = "0"
    b = corpo(perfis, merchants, tx_id="teste-stream-0001", amount_usd=12.0)
    hist_antes = json.loads(r.get(f"fraud:profile:{b['card_key']}"))["total_tx"]
    j = c.post("/transactions", json=b).json()
    w = Worker(Store(URL), Persistencia(), nome="worker-teste")
    while w.ciclo(bloquear_ms=200, forcar_flush=True):
        pass
    assert r.get("fraud:status:teste-stream-0001").startswith("processado")
    assert r.xpending(STREAM, GRUPO)["pending"] == 0          # ACK depois de persistir
    hist_depois = json.loads(r.get(f"fraud:profile:{b['card_key']}"))["total_tx"]
    assert hist_depois == hist_antes + (0 if j["decision"] == "investigar" else 1)
    # reentrega da mesma mensagem não aplica de novo no perfil
    r.xadd(STREAM, {"dados": json.dumps({"tx_id": "teste-stream-0001", "card_key": b["card_key"], "decision": "aprovar"})})
    while w.ciclo(bloquear_ms=200, forcar_flush=True):
        pass
    assert json.loads(r.get(f"fraud:profile:{b['card_key']}"))["total_tx"] == hist_depois


def test_recuperacao_apos_falha_do_worker(ambiente):
    """Worker A lê e cai antes do ACK; worker B retoma a mensagem órfã e persiste."""
    c, r, perfis, merchants = ambiente
    from app.store import GRUPO, STREAM, Store
    from app.worker import Persistencia, Worker
    os.environ["BQ_ENABLED"] = "0"
    c.post("/transactions", json=corpo(perfis, merchants, tx_id="teste-falha-0001", amount_usd=15.0))
    r.xreadgroup(GRUPO, "worker-que-caiu", {STREAM: ">"}, count=10)          # lê e "morre" sem ACK
    assert r.xpending(STREAM, GRUPO)["pending"] >= 1
    w = Worker(Store(URL), Persistencia(), nome="worker-substituto")
    w.ciclo(bloquear_ms=100, forcar_flush=True, ocioso_ms=0)
    assert r.get("fraud:status:teste-falha-0001").startswith("processado")
    assert r.xpending(STREAM, GRUPO)["pending"] == 0


def test_falha_de_dependencia_e_explicita():
    from fastapi.testclient import TestClient
    from app import main
    original = main.STORE
    main.STORE = __import__("app.store", fromlist=["Store"]).Store("redis://127.0.0.1:1/0")   # Redis inexistente
    try:
        c = TestClient(main.app)
        resp = c.post("/transactions/score", json={"card_key": "a" * 16, "merchant": "x" * 3, "amount_usd": 10, "hora": 10, "local": "perto_de_casa"})
        assert resp.status_code == 503 and resp.json()["detail"]["codigo"] == "feature_store_indisponivel"   # nunca aprova por padrão
    finally:
        main.STORE = original


def test_endpoints_protegidos(ambiente):
    c, *_ = ambiente
    assert c.post("/admin/replay?acao=iniciar").status_code == 401
    assert c.post("/admin/replay?acao=pausar", headers={"Authorization": "Bearer errado"}).status_code == 401
    assert c.post("/admin/replay?acao=pausar", headers={"Authorization": "Bearer token-de-teste"}).status_code == 200


def test_psi_detecta_perturbacao_controlada():
    from app.replay import psi
    rng = np.random.default_rng(0)
    base = rng.lognormal(3.5, 1.0, 20000)
    bordas = np.unique(np.quantile(base, np.linspace(0, 1, 11)))
    cont = np.histogram(base, bins=bordas)[0]
    ref = {"bordas": bordas.tolist(), "proporcoes": (cont / cont.sum()).tolist(), "n": len(base)}
    assert psi(ref, rng.lognormal(3.5, 1.0, 5000)) < 0.1          # mesma distribuição: estável
    assert psi(ref, rng.lognormal(3.5, 1.0, 5000) * 3) > 0.25     # valores ×3: drift
    assert psi(ref, np.array([1.0] * 50)) is None                 # amostra pequena: não publica


def test_recall_nao_publicado_antes_da_maturacao(ambiente):
    _, r, *_ = ambiente
    from app.replay import atualizar_monitoramento
    from app.store import Store
    st = Store(URL)
    r.delete("fraud:labels:pendentes", "fraud:labels:maduros")
    r.zadd("fraud:labels:pendentes", {json.dumps({"tx_id": "x1", "label": 1, "valor": 100.0, "score": 0.9, "decisao": "investigar", "challenger": "investigar", "ts": 1000}): 1000 + 30 * 86400})
    ref = {"score": {"bordas": [0, 0.5, 1], "proporcoes": [0.5, 0.5], "n": 100}}
    atualizar_monitoramento(st, ref, {"score": [0.1] * 10}, ["aprovar"], relogio=2000, cursor=1, total=10, deriva=1.0)
    mon = json.loads(r.get("fraud:monitoring"))
    assert mon["desempenho_safra_madura"] is None and mon["rotulos"]["pendentes"] == 1
    atualizar_monitoramento(st, ref, {"score": [0.1] * 10}, ["aprovar"], relogio=1000 + 30 * 86400, cursor=2, total=10, deriva=1.0)
    mon = json.loads(r.get("fraud:monitoring"))
    assert mon["desempenho_safra_madura"]["recall"] == 1.0 and mon["rotulos"]["maduros"] == 1


def test_rate_limit_nao_confia_no_ip_forjado(ambiente):
    """Trocar o primeiro IP do X-Forwarded-For não escapa do limite: vale o IP que o proxy acrescentou (o último)."""
    c, r, perfis, merchants = ambiente
    from app import main
    limite_original = main.LIMITE_MIN
    main.LIMITE_MIN = 3
    try:
        codigos = [c.get("/profiles?limite=1", headers={"X-Forwarded-For": f"9.9.9.{i}, 203.0.113.7"}).status_code for i in range(6)]
        assert codigos.count(429) >= 3
    finally:
        main.LIMITE_MIN = limite_original


def test_campo_extra_rejeitado(ambiente):
    """O navegador não pode mandar histórico: campo não previsto dá 422."""
    c, _, perfis, merchants = ambiente
    assert c.post("/transactions/score", json=corpo(perfis, merchants, historico=[{"amount": 1}])).status_code == 422


def test_mensagem_envenenada_vai_para_dlq(ambiente):
    _, r, *_ = ambiente
    from app.store import DLQ, GRUPO, STREAM, Store
    from app.worker import Persistencia, Worker
    os.environ["BQ_ENABLED"] = "0"
    antes = r.xlen(DLQ) if r.exists(DLQ) else 0
    r.xadd(STREAM, {"dados": "{isto nao e json"})
    w = Worker(Store(URL), Persistencia(), nome="worker-dlq")
    w.ciclo(bloquear_ms=100, forcar_flush=True)
    assert r.xlen(DLQ) == antes + 1
    assert r.xpending(STREAM, GRUPO)["pending"] == 0          # sem loop infinito de reentrega


def test_marcador_de_aplicacao_e_atomico(ambiente):
    """Reentrega depois de aplicada não soma de novo: o marcador nasce no mesmo MULTI do perfil."""
    c, r, perfis, merchants = ambiente
    from app.store import Store
    from app.worker import aplicar_no_perfil
    ck = next(iter(perfis))
    ev = {"tx_id": "teste-atomico-0001", "card_key": ck, "decision": "aprovar",
          "tx": {"ts": 1_700_000_000, "amount_usd": 10.0, "merchant": "X", "category": "home"}}
    antes = json.loads(r.get(f"fraud:profile:{ck}"))["total_tx"]
    st = Store(URL)
    assert aplicar_no_perfil(st, ev) == "aplicada"
    assert aplicar_no_perfil(st, ev).startswith("já aplicada")
    assert json.loads(r.get(f"fraud:profile:{ck}"))["total_tx"] == antes + 1


def test_redis_fora_do_ar_da_503_em_todo_endpoint():
    from fastapi.testclient import TestClient
    from app import main
    from app.store import Store
    original = main.STORE
    main.STORE = Store("redis://127.0.0.1:1/0")
    try:
        c = TestClient(main.app)
        for rota in ("/profiles", "/merchants", "/metrics", "/scenarios"):
            assert c.get(rota).status_code == 503, rota
    finally:
        main.STORE = original
