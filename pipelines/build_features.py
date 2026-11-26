"""Silver + Gold no BigQuery e exportação da Gold para Parquet local (treino fora do BigQuery).

Uso: python build_features.py [--so-exportar]
"""
from __future__ import annotations

import json
import os
import sys

import pandas as pd

from common import BQ, DADOS, RAIZ, RELATORIOS


def rodar_arquivo(bq: BQ, caminho, rotulo, params=None):
    sql = caminho.read_text(encoding="utf-8")
    comandos = [c.strip() for c in sql.split(";") if c.strip() and not all(l.strip().startswith("--") for l in c.strip().splitlines())]
    res = None
    for i, c in enumerate(comandos, 1):
        res = bq.executar(c, f"{rotulo}_{i}", params=params)
    return res


def main():
    bq = BQ()
    if "--so-exportar" not in sys.argv:
        salt = os.environ["CARD_SALT"]
        rodar_arquivo(bq, RAIZ / "sql/silver/01_silver_transactions.sql", "silver", {"salt": salt})
        q = rodar_arquivo(bq, RAIZ / "sql/silver/02_quality.sql", "qualidade")
        qualidade = {r["verificacao"]: r["valor"] for r in q}
        (RELATORIOS / "metrics" / "qualidade_silver.json").write_text(json.dumps(qualidade, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(qualidade, ensure_ascii=False, indent=1))
        rodar_arquivo(bq, RAIZ / "sql/gold/01_gold_training_features.sql", "gold_features")

    # Exporta a Gold para Parquet local (Storage Read API: leitura, sem custo de consulta)
    destino = DADOS / "gold" / "gold_training_features.parquet"
    destino.parent.mkdir(parents=True, exist_ok=True)
    df = bq.client.list_rows(bq.tabela("gold_training_features")).to_dataframe(create_bqstorage_client=True)
    # NUMERIC do BigQuery chega como Decimal: tudo vira float; data vira tipo comum (sem metadado dbdate)
    for c in ["amount_usd", "avg_amount_7d", "avg_amount_30d", "std_amount_30d", "amount_vs_avg_30d", "sum_amount_24h"]:
        df[c] = pd.to_numeric(df[c].astype("object"), errors="coerce").astype(float)
    df["event_date"] = pd.to_datetime(df["event_date"].astype(str))
    df.to_parquet(destino, index=False)
    resumo = df.groupby("split").agg(linhas=("label", "size"), fraudes=("label", "sum"), inicio=("event_ts", "min"), fim=("event_ts", "max"))
    resumo["taxa"] = resumo.fraudes / resumo.linhas
    print(resumo.to_string())
    (RELATORIOS / "metrics" / "splits.json").write_text(resumo.astype(str).to_json(orient="index", force_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
