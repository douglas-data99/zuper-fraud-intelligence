"""Política de 3 níveis e motor de custo: bordas, ordem dos cortes, conta manual e otimizador vs força bruta."""
import itertools

import numpy as np
import pytest

from app.decision import Politica, candidatos_corte, custos_por_acao, otimizar_cortes, resumo_politica

CFG = {"acoes": {"aprovar": {"custo_acao": 0, "atrito_legitimo": 0, "eficacia": 0},
                 "autenticar": {"custo_acao": 1, "atrito_legitimo": 2, "eficacia": 0.5},
                 "investigar": {"custo_acao": 10, "atrito_legitimo": 20, "eficacia": 1.0}},
       "capacidade_investigacao_max": None, "grade_cortes": 50}


def test_bordas_exatas():
    p = Politica(0.1, 0.5, "t")
    assert p.decidir(0.0999999) == "aprovar"
    assert p.decidir(0.1) == "autenticar"          # corte é inclusivo (>=)
    assert p.decidir(0.4999999) == "autenticar"
    assert p.decidir(0.5) == "investigar"
    assert list(p.decidir_vetor(np.array([0.05, 0.1, 0.5, 0.9]))) == [0, 1, 2, 2]


def test_ordem_dos_cortes_obrigatoria():
    with pytest.raises(ValueError):
        Politica(0.6, 0.5, "invalida")
    Politica(0.3, 0.3, "um-corte")  # t_auth == t_review é permitido (sem faixa de verificação)


def test_custo_calculado_a_mao():
    y = np.array([1, 0])
    v = np.array([100.0, 50.0])
    M = custos_por_acao(y, v, CFG)
    # fraude de 100: aprovar 100 | autenticar 1 + 100*0.5 = 51 | investigar 10 + 0 = 10
    # legítima: aprovar 0 | autenticar 1 + 2 = 3 | investigar 10 + 20 = 30
    assert M.tolist() == [[100, 51, 10], [0, 3, 30]]


def test_otimizador_igual_forca_bruta():
    rng = np.random.default_rng(0)
    n = 400
    y = (rng.random(n) < 0.08).astype(int)
    s = np.clip(rng.normal(0.2 + 0.5 * y, 0.15), 0, 1)
    v = rng.uniform(5, 500, n)
    res = otimizar_cortes(s, y, v, CFG, grade=40)
    M = custos_por_acao(y, v, CFG)
    cand = candidatos_corte(s, 40)
    melhor = min(M[np.arange(n), np.where(s >= b, 2, np.where(s >= a, 1, 0))].sum()
                 for a, b in itertools.combinations_with_replacement(cand, 2))
    assert res["custo_3_niveis"] == pytest.approx(melhor, rel=1e-9)
    assert res["t_auth"] <= res["t_review"]
    assert res["custo_3_niveis"] <= res["custo_1_corte"] + 1e-9 <= res["custo_aprovar_tudo"] + 1e-9


def test_capacidade_de_investigacao_respeitada():
    rng = np.random.default_rng(1)
    y = (rng.random(1000) < 0.2).astype(int)
    s = np.clip(rng.normal(0.3 + 0.4 * y, 0.2), 0, 1)
    v = rng.uniform(50, 900, 1000)
    res = otimizar_cortes(s, y, v, CFG, grade=60, cap_investigacao=0.02)
    assert res["pct_investigar"] <= 0.02 + 1e-12


def test_resumo_sem_dupla_contagem():
    y = np.array([1, 1, 0, 0])
    v = np.array([100.0, 200.0, 30.0, 40.0])
    s = np.array([0.9, 0.3, 0.3, 0.05])
    r = resumo_politica(s, y, v, Politica(0.2, 0.8, "t"), CFG)
    assert r["custo_total"] == pytest.approx(r["custo_operacional"] + r["custo_atrito"] + r["perda_residual"])
    assert r["custo_aprovar_tudo"] == 300
    assert r["investigar"]["fraudes"] == 1 and r["autenticar"]["fraudes"] == 1 and r["autenticar"]["legitimas"] == 1


def test_grade_enxerga_a_cauda():
    """A cauda superior entra inteira nos candidatos (a grade só de quantis andava em passos grossos)."""
    rng = np.random.default_rng(2)
    s = rng.beta(0.5, 30, 100_000)
    cand = candidatos_corte(s, 300, cauda=0.03)
    topo = np.unique(np.sort(s)[int(len(s) * 0.97):])
    assert np.isin(topo, cand).all()
