"""Carrega o snapshot (Gold) no Redis e escolhe os 3 cenários de demonstração.

Cenários (regra reproduzível, semente fixa): para cartões maduros, montamos 3 transações candidatas
(habitual, ambígua, atípica) com lojas e valores do próprio perfil, rodamos o what-if REAL e guardamos
exemplos cuja decisão real caiu em aprovar / autenticar / investigar. Nada é forçado: se um tipo não
aparece, o cenário é exibido com o resultado real e a explicação.
Uso: python -m app.loader <pasta_serving> [--redis URL]
"""
from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timezone

from .features import Perfil, calcular_online
from .main_deps import modelo_padrao
from .store import Store, k_merchant, k_perfil


def carregar(pasta: str, url: str):
    st = Store(url)
    perfis = json.load(open(f"{pasta}/perfis.json", encoding="utf-8"))
    merchants = json.load(open(f"{pasta}/merchants.json", encoding="utf-8"))
    p = st.r.pipeline()
    for m, info in merchants.items():
        p.set(k_merchant(m), json.dumps(info))
    cards = []
    por_cat = {}
    for m, info in merchants.items():
        por_cat.setdefault(info["categoria"], []).append(m)
    for ck, d in perfis.items():
        contagem = {}
        for u in d["ultimas"]:
            contagem[u["merchant"]] = contagem.get(u["merchant"], 0) + 1
        d["lojas_sugeridas"] = [m for m, _ in sorted(contagem.items(), key=lambda x: -x[1])[:5]]
        p.set(k_perfil(ck), json.dumps(d))
        cards.append({"card_key": ck, "historico_total": d["total_tx"], "ultimos_30d": len(d["ultimas"]),
                      "categoria_mais_comum": d["categoria_mais_comum"], "ticket_medio_historico": d["ticket_medio_historico"]})
    cards.sort(key=lambda c: -c["ultimos_30d"])
    p.set("fraud:card_list", json.dumps(cards))
    p.set("fraud:merchant_list", json.dumps(sorted([{"merchant": m, "categoria": i["categoria"]} for m, i in merchants.items()],
                                                   key=lambda x: (x["categoria"], x["merchant"]))))
    p.set("fraud:n_perfis", len(perfis))
    p.set("fraud:clock", max(d["snapshot_ts"] for d in perfis.values()))
    p.execute()
    return st, perfis, merchants, por_cat


def escolher_cenarios(st, perfis, merchants, por_cat, semente=42):
    modelo = modelo_padrao()
    rnd = random.Random(semente)
    maduros = [d for d in perfis.values() if len(d["ultimas"]) >= 40]
    rnd.shuffle(maduros)
    achados = {}
    for d in maduros[:120]:
        perfil = Perfil(d["card_key"], d["home_lat"], d["home_long"], d["total_tx"], set(d["merchants_vistos"]), d["ultimas"], d["snapshot_ts"])
        base_ts = d["snapshot_ts"] + 3600
        ticket = sum(u["amount"] for u in d["ultimas"]) / len(d["ultimas"])
        loja_hab = d["lojas_sugeridas"][0]
        nova = [m for m in por_cat["shopping_net"] if m not in perfil.merchants_vistos]
        nova_pos = [m for m in por_cat["grocery_pos"] if m not in perfil.merchants_vistos]
        candidatos = [
            ("habitual", "Compra de rotina na loja de sempre, valor típico, à tarde", loja_hab, round(ticket, 2), 15, "perto_de_casa"),
            ("ambiguo", "Mercado novo, valor 4x o ticket, começo da noite", rnd.choice(nova_pos) if nova_pos else loja_hab, round(ticket * 4, 2), 21, "cidade_vizinha"),
            ("atipico", "Loja online nunca usada, valor alto, de madrugada", rnd.choice(nova) if nova else loja_hab, round(min(max(ticket * 12, 750), 1200), 2), 2, "outro_estado"),
        ]
        for tipo, desc, loja, valor, hora, local in candidatos:
            if tipo in achados:
                continue
            dia = datetime.fromtimestamp(base_ts, tz=timezone.utc).replace(hour=hora, minute=0, second=0)
            ts = int(dia.timestamp()) + (86400 if int(dia.timestamp()) < base_ts else 0)
            deslocs = {"perto_de_casa": (0.02, 0.02), "cidade_vizinha": (0.45, 0.35), "outro_estado": (6.0, -9.0)}
            dlat, dlon = deslocs[local]
            tx = {"ts": ts, "amount_usd": valor, "merchant": loja, "category": merchants[loja]["categoria"],
                  "merch_lat": d["home_lat"] + dlat, "merch_long": d["home_long"] + dlon}
            feat = calcular_online(perfil, tx, merchants[loja]["merchant_distinct_cards_30d"])
            r = modelo.pontuar(feat, com_motivos=False, shadow=False)
            esperado = {"habitual": "aprovar", "ambiguo": "autenticar", "atipico": "investigar"}[tipo]
            if r["decision"] == esperado:
                achados[tipo] = {"tipo": tipo, "descricao": desc, "card_key": d["card_key"], "merchant": loja,
                                 "categoria": merchants[loja]["categoria"], "amount_usd": valor, "hora": hora, "local": local,
                                 "decisao_na_selecao": r["decision"], "score_na_selecao": round(r["calibrated_score"], 4),
                                 "regra": "selecionado por what-if real sobre o snapshot; o resultado mostrado é sempre o da API"}
        if len(achados) == 3:
            break
    lista = [achados[t] for t in ("habitual", "ambiguo", "atipico") if t in achados]
    st.r.set("fraud:scenarios", json.dumps(lista))
    return lista


if __name__ == "__main__":
    pasta = sys.argv[1]
    url = sys.argv[sys.argv.index("--redis") + 1] if "--redis" in sys.argv else "redis://localhost:6379/0"
    st, perfis, merchants, por_cat = carregar(pasta, url)
    cen = escolher_cenarios(st, perfis, merchants, por_cat)
    print(f"perfis={len(perfis)} merchants={len(merchants)} cenarios={[c['tipo'] for c in cen]}")
