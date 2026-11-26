"""Features online: point-in-time, cold start, empates e ausência do rótulo."""
from app.features import COMPORTAMENTAIS, TRANSACIONAIS, Perfil, atualizar_perfil, calcular_online, colunas

TX = {"ts": 1_000_000, "amount_usd": 80.0, "merchant": "Loja A", "category": "grocery_pos", "merch_lat": 10.0, "merch_long": 10.0}


def perfil_com(hist):
    p = Perfil("abcd1234abcd1234", 10.0, 10.0)
    for h in hist:
        atualizar_perfil(p, h)
    return p


def test_cold_start_explicito():
    f = calcular_online(Perfil("abcd1234abcd1234", 10.0, 10.0), TX, 5)
    assert f["profile_history_count"] == 0 and f["tx_count_24h"] == 0 and f["sum_amount_24h"] == 0
    assert f["avg_amount_30d"] is None and f["std_amount_30d"] is None and f["time_since_last_tx_s"] is None
    assert f["is_new_merchant"] == 1


def test_janela_exclui_a_propria_e_o_mesmo_segundo():
    p = perfil_com([{**TX, "ts": TX["ts"] - 100, "amount_usd": 10.0}, {**TX, "ts": TX["ts"], "amount_usd": 999.0}])
    f = calcular_online(p, TX, 5)
    assert f["tx_count_24h"] == 1 and f["sum_amount_24h"] == 10.0     # a do mesmo segundo não entra
    assert f["profile_history_count"] == 1


def test_evento_futuro_nao_altera_feature_passada():
    hist = [{**TX, "ts": TX["ts"] - k * 3600, "amount_usd": 20.0 + k} for k in range(1, 30)]
    antes = calcular_online(perfil_com(hist), TX, 5)
    futuro = hist + [{**TX, "ts": TX["ts"] + 60, "amount_usd": 5000.0, "merchant": "Loja Z"}]
    depois = calcular_online(perfil_com(futuro), TX, 5)
    assert antes == depois


def test_limites_inclusivos_da_janela():
    p = perfil_com([{**TX, "ts": TX["ts"] - 1800, "amount_usd": 1.0}, {**TX, "ts": TX["ts"] - 1801, "amount_usd": 1.0}])
    f = calcular_online(p, TX, 5)
    assert f["tx_count_30min"] == 1       # t-1800 entra (RANGE 1800 PRECEDING é inclusivo); t-1801 não


def test_rotulo_nunca_e_feature():
    for c in colunas("B"):
        assert "fraud" not in c and "label" not in c
    assert set(TRANSACIONAIS + COMPORTAMENTAIS) <= set(colunas("B"))
