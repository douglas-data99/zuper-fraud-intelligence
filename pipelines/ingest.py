"""Ingestão Bronze: confere checksum dos CSVs e carrega o snapshot original no BigQuery.

Load jobs do BigQuery não cobram processamento; só o armazenamento.
Saída: tabela bronze_raw_transactions + reports/metrics/ingestao.json
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from common import BQ, DADOS, RELATORIOS, config, sha256_arquivo


def main():
    cfg = config("data")
    bq = BQ()
    bq.garantir_dataset()
    agora = datetime.now(timezone.utc)
    resumo = {"fonte": cfg["source"]["kaggle"], "licenca": cfg["source"]["license"], "ingestao_utc": agora.isoformat(), "arquivos": {}}
    partes = []
    for nome, esperado in cfg["source"]["files"].items():
        caminho = DADOS / "raw" / nome
        obtido = sha256_arquivo(caminho)
        if obtido != esperado:
            raise SystemExit(f"checksum diferente em {nome}: {obtido}")
        df = pd.read_csv(caminho, dtype={"cc_num": "string", "zip": "string"})
        df = df.drop(columns=["Unnamed: 0"])  # índice exportado: nunca vira feature
        df["source_file"] = nome
        df["source_sha256"] = obtido
        df["ingested_at"] = pd.Timestamp(agora)
        df["event_date"] = pd.to_datetime(df["trans_date_trans_time"]).dt.date
        resumo["arquivos"][nome] = {
            "sha256": obtido,
            "linhas": int(len(df)),
            "fraudes": int(df.is_fraud.sum()),
            "inicio": str(df.trans_date_trans_time.min()),
            "fim": str(df.trans_date_trans_time.max()),
            "nulos": int(df.isna().sum().sum()),
            "trans_num_duplicados": int(df.trans_num.duplicated().sum()),
        }
        partes.append(df)
    bronze = pd.concat(partes, ignore_index=True)
    resumo["trans_num_duplicados_total"] = int(bronze.trans_num.duplicated().sum())

    job_cfg = bq.bq.LoadJobConfig(
        write_disposition="WRITE_TRUNCATE",
        time_partitioning=bq.bq.TimePartitioning(field="event_date", type_=bq.bq.TimePartitioningType.MONTH),
        clustering_fields=["cc_num"],
    )
    job = bq.client.load_table_from_dataframe(bronze, bq.tabela("bronze_raw_transactions"), job_config=job_cfg)
    job.result()
    t = bq.client.get_table(bq.tabela("bronze_raw_transactions"))
    resumo["bronze"] = {"tabela": t.full_table_id, "linhas": t.num_rows, "bytes": t.num_bytes}
    (RELATORIOS / "metrics").mkdir(parents=True, exist_ok=True)
    (RELATORIOS / "metrics" / "ingestao.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(resumo["bronze"], ensure_ascii=False))


if __name__ == "__main__":
    main()
