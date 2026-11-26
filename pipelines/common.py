"""Utilidades compartilhadas: configuração, caminhos, cliente BigQuery com trava de custo."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import yaml

try:  # tipos dbdate/dbtime gravados nos Parquet exportados do BigQuery
    import db_dtypes  # noqa: F401
except ImportError:
    pass

RAIZ = Path(__file__).resolve().parents[1]
DADOS = RAIZ / "data"
ARTEFATOS = RAIZ / "artifacts"
RELATORIOS = RAIZ / "reports"


def carregar_env() -> None:
    """Lê RAIZ/.env (formato CHAVE=valor) sem sobrescrever variáveis já definidas."""
    arq = RAIZ / ".env"
    if not arq.exists():
        return
    for linha in arq.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        k, v = linha.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())
    cred = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if cred and not Path(cred).is_absolute():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(RAIZ / cred)


def config(nome: str) -> dict:
    return yaml.safe_load((RAIZ / "configs" / f"{nome}.yaml").read_text(encoding="utf-8"))


def sha256_arquivo(caminho: Path) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


class BQ:
    """Cliente BigQuery com limite de bytes por consulta e registro do consumo."""

    def __init__(self):
        carregar_env()
        from google.cloud import bigquery

        self.bq = bigquery
        c = config("data")["gcp"]
        self.projeto, self.dataset, self.local = c["project"], c["dataset"], c["location"]
        self.max_bytes = int(c["max_bytes_billed"])
        self.client = bigquery.Client(project=self.projeto, location=self.local)
        self.log = RELATORIOS / "metrics" / "bigquery_consumo.jsonl"
        self.log.parent.mkdir(parents=True, exist_ok=True)

    def tabela(self, nome: str) -> str:
        return f"{self.projeto}.{self.dataset}.{nome}"

    def garantir_dataset(self):
        ds = self.bq.Dataset(f"{self.projeto}.{self.dataset}")
        ds.location = self.local
        ds.description = "Zuper Fraud Intelligence - dados públicos sintéticos (Sparkov, CC0)."
        self.client.create_dataset(ds, exists_ok=True)

    def executar(self, sql: str, rotulo: str, dry_run_primeiro: bool = True, params: dict | None = None):
        """Roda SQL com dry run (estimativa) + maximum_bytes_billed. Registra bytes faturados."""
        sql = sql.replace("{P}", self.projeto).replace("{D}", self.dataset)
        qp = [self.bq.ScalarQueryParameter(k, "STRING", v) for k, v in (params or {}).items()]
        if dry_run_primeiro:
            dry = self.client.query(sql, job_config=self.bq.QueryJobConfig(dry_run=True, use_query_cache=False, query_parameters=qp))
            estimado = dry.total_bytes_processed or 0
            if estimado > self.max_bytes:
                raise RuntimeError(f"{rotulo}: estimativa {estimado/2**30:.2f} GiB acima do limite")
        job = self.client.query(
            sql,
            job_config=self.bq.QueryJobConfig(maximum_bytes_billed=self.max_bytes, query_parameters=qp, labels={"etapa": rotulo[:60].lower().replace(" ", "_")}),
        )
        res = job.result()
        reg = {
            "rotulo": rotulo,
            "job_id": job.job_id,
            "bytes_processados": job.total_bytes_processed,
            "bytes_faturados": job.total_bytes_billed,
            "slot_ms": job.slot_millis,
            "inicio": str(job.started),
            "fim": str(job.ended),
        }
        with open(self.log, "a", encoding="utf-8") as f:
            f.write(json.dumps(reg, ensure_ascii=False) + "\n")
        print(f"[bq] {rotulo}: {(job.total_bytes_billed or 0)/2**20:.1f} MiB faturados")
        return res
