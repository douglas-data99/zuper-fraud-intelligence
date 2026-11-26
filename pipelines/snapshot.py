"""Gera no BigQuery o snapshot de cartões/merchants e exporta para JSON (carga do Redis) + o fluxo de replay.

Saídas:
  data/serving/perfis.json      -> fraud:profile:{card_key}
  data/serving/merchants.json   -> fraud:merchant:{merchant}
  data/serving/replay.parquet   -> período de teste em ordem cronológica (com rótulo, liberado com atraso no replay)
"""
from __future__ import annotations

import json

from common import BQ, DADOS, RAIZ
from build_features import rodar_arquivo


def main():
    bq = BQ()
    rodar_arquivo(bq, RAIZ / "sql/gold/02_gold_snapshot.sql", "snapshot")
    destino = DADOS / "serving"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.mkdir(exist_ok=True)

    perfis = bq.client.list_rows(bq.tabela("gold_customer_snapshot")).to_dataframe(create_bqstorage_client=True)
    saida = {}
    for r in perfis.itertuples(index=False):
        saida[r.card_key] = {
            "card_key": r.card_key, "home_lat": float(r.home_lat), "home_long": float(r.home_long),
            "total_tx": int(r.total_tx), "merchants_vistos": sorted(list(r.merchants_vistos)),
            "ultimas": [{"ts": int(u["ts"]), "amount": float(u["amount"]), "merchant": u["merchant"], "category": u["category"]}
                        for u in r.ultimas_30d],
            "snapshot_ts": int(r.snapshot_ts), "categoria_mais_comum": r.categoria_mais_comum,
            "ticket_medio_historico": round(float(r.ticket_medio_historico), 2),
        }
    (destino / "perfis.json").write_text(json.dumps(saida), encoding="utf-8")

    m = bq.client.list_rows(bq.tabela("gold_merchant_snapshot")).to_dataframe(create_bqstorage_client=True)
    (destino / "merchants.json").write_text(json.dumps({r.merchant: {"categoria": r.categoria, "merchant_distinct_cards_30d": int(r.merchant_distinct_cards_30d)}
                                                        for r in m.itertuples(index=False)}), encoding="utf-8")

    sql = """SELECT tx_id, card_key, ts_sec, event_ts, merchant, category, CAST(amount_usd AS FLOAT64) AS amount_usd,
                    merch_lat, merch_long, is_fraud
             FROM `{P}.{D}.silver_transactions` WHERE event_ts >= TIMESTAMP('2020-06-21 12:14:00') ORDER BY ts_sec, tx_id"""
    replay = bq.executar(sql, "replay_export").to_dataframe(create_bqstorage_client=True)
    replay.to_parquet(destino / "replay.parquet", index=False)
    print(f"perfis={len(saida)} merchants={len(m)} replay={len(replay)}")


if __name__ == "__main__":
    main()
