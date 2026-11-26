"""Motor de decisão em 3 níveis: aprovar < t_auth <= autenticar < t_review <= investigar.

O custo de uma transação i com valor A_i, rótulo y_i e ação a é:
    custo = custo_acao(a) + (1 - y_i) * atrito_legitimo(a) + y_i * A_i * (1 - eficacia(a))
Aprovar: custo_acao = 0, atrito = 0, eficácia = 0  ->  custo = y_i * A_i (a fraude passa inteira).
Todos os parâmetros vêm de configs/policy.yaml e são hipóteses de negócio, não dados observados.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

ACOES = ("aprovar", "autenticar", "investigar")


@dataclass(frozen=True)
class Politica:
    t_auth: float
    t_review: float
    versao: str

    def __post_init__(self):
        if not (0.0 <= self.t_auth <= self.t_review <= 1.0 + 1e-12):
            raise ValueError("cortes inválidos: exige 0 <= t_auth <= t_review <= 1")

    def decidir(self, score: float) -> str:
        if score >= self.t_review:
            return "investigar"
        if score >= self.t_auth:
            return "autenticar"
        return "aprovar"

    def decidir_vetor(self, scores: np.ndarray) -> np.ndarray:
        return np.where(scores >= self.t_review, 2, np.where(scores >= self.t_auth, 1, 0))


def custos_por_acao(y: np.ndarray, valor: np.ndarray, cfg: dict) -> np.ndarray:
    """Matriz (n, 3): custo de cada transação sob cada ação."""
    y = np.asarray(y, dtype=float)
    valor = np.asarray(valor, dtype=float)
    cols = []
    for a in ACOES:
        p = cfg["acoes"][a]
        cols.append(p["custo_acao"] + (1 - y) * p["atrito_legitimo"] + y * valor * (1 - p["eficacia"]))
    return np.column_stack(cols)


def custo_total(acoes_idx: np.ndarray, matriz: np.ndarray) -> float:
    return float(matriz[np.arange(len(acoes_idx)), acoes_idx].sum())


def candidatos_corte(scores: np.ndarray, grade: int = 300, cauda: float = 0.03, max_cauda: int = 6000) -> np.ndarray:
    """Quantis no corpo da distribuição + TODOS os scores únicos da cauda superior (onde a decisão acontece).
    Uma grade só de quantis anda em passos de n/grade linhas e não enxerga a cauda (revisão E2)."""
    s = np.sort(np.asarray(scores, dtype=float))
    q = np.quantile(s, np.linspace(0, 1, grade))
    topo = np.unique(s[int(len(s) * (1 - cauda)):])
    if len(topo) > max_cauda:
        topo = np.quantile(topo, np.linspace(0, 1, max_cauda))
    return np.unique(np.concatenate([q, topo, [1.0 + 1e-9]]))


def otimizar_cortes(scores, y, valor, cfg, grade: int | None = None, cap_investigacao: float | None = None):
    """Busca exaustiva em pares (t_auth <= t_review) sobre os candidatos, com somas acumuladas (vetorizada por t_auth).

    Retorna dict com cortes, custo e o custo de referência de 'aprovar tudo' e da melhor política de um corte.
    """
    scores = np.asarray(scores, dtype=float)
    n = len(scores)
    grade = grade or cfg.get("grade_cortes", 300)
    cap = cfg.get("capacidade_investigacao_max") if cap_investigacao is None else cap_investigacao
    M = custos_por_acao(y, valor, cfg)
    ordem = np.argsort(scores, kind="mergesort")
    s_ord = scores[ordem]
    pref = np.vstack([np.zeros(3), np.cumsum(M[ordem], axis=0)])  # pref[k] = soma das k primeiras linhas
    tot = pref[-1]
    cand = candidatos_corte(scores, grade)
    pos = np.searchsorted(s_ord, cand, side="left")  # nº de linhas com score < corte
    ok_cap = np.ones(len(cand), bool) if cap is None else ((n - pos) / n <= cap + 1e-12)
    melhor = (np.inf, None, None)
    for i in range(len(cand)):
        kr = pos[i:]
        c = pref[pos[i], 0] + (pref[kr, 1] - pref[pos[i], 1]) + (tot[2] - pref[kr, 2])
        c = np.where(ok_cap[i:], c, np.inf)
        j = int(np.argmin(c))
        if c[j] < melhor[0]:
            melhor = (float(c[j]), i, i + j)
    c, ia, ir = melhor
    ta, tr, ka, kr = cand[ia], cand[ir], pos[ia], pos[ir]
    um = pref[pos, 0] + (tot[2] - pref[pos, 2])
    um = np.where(ok_cap, um, np.inf)
    j1 = int(np.argmin(um))
    return {
        "t_auth": float(min(ta, 1.0)),
        "t_review": float(min(tr, 1.0)),
        "custo_3_niveis": float(c),
        "custo_aprovar_tudo": float(tot[0]),
        "custo_1_corte": float(um[j1]),
        "t_1_corte": float(min(cand[j1], 1.0)),
        "pct_autenticar": float((kr - ka) / n),
        "pct_investigar": float((n - kr) / n),
        "n": n,
        "candidatos_avaliados": int(len(cand)),
    }


def resumo_politica(scores, y, valor, pol: Politica, cfg: dict) -> dict:
    """Mede uma política congelada num conjunto: ações, fraudes por ação, valores e custos (premissas)."""
    scores, y, valor = np.asarray(scores, float), np.asarray(y, int), np.asarray(valor, float)
    a = pol.decidir_vetor(scores)
    M = custos_por_acao(y, valor, cfg)
    out = {"n": int(len(y)), "fraudes": int(y.sum()), "valor_fraudado": float(valor[y == 1].sum())}
    for k, nome in enumerate(ACOES):
        m = a == k
        out[nome] = {
            "transacoes": int(m.sum()),
            "pct": float(m.mean()),
            "fraudes": int((m & (y == 1)).sum()),
            "legitimas": int((m & (y == 0)).sum()),
            "valor_fraude": float(valor[m & (y == 1)].sum()),
        }
    sinalizadas = a > 0
    efic = np.array([cfg["acoes"][n]["eficacia"] for n in ACOES])[a]
    out["valor_fraude_sinalizado"] = float(valor[sinalizadas & (y == 1)].sum())
    out["valor_potencialmente_evitado"] = float((valor * efic)[y == 1].sum())
    out["recall_valor_sinalizado"] = out["valor_fraude_sinalizado"] / max(out["valor_fraudado"], 1e-9)
    out["custo_total"] = custo_total(a, M)
    out["custo_aprovar_tudo"] = float(M[:, 0].sum())
    out["beneficio_liquido_vs_aprovar_tudo"] = out["custo_aprovar_tudo"] - out["custo_total"]
    out["custo_operacional"] = float(sum(cfg["acoes"][ACOES[k]]["custo_acao"] * (a == k).sum() for k in range(3)))
    out["custo_atrito"] = float(sum(cfg["acoes"][ACOES[k]]["atrito_legitimo"] * ((a == k) & (y == 0)).sum() for k in range(3)))
    out["perda_residual"] = float((valor * (1 - efic))[y == 1].sum())
    return out
