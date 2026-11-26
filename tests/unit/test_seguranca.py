"""Segredos fora do git e das respostas."""
import re
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PADROES = [r"github_pat_[A-Za-z0-9_]{20,}", r"KGAT_[A-Za-z0-9]{10,}", "-----BEGIN " + "PRIVATE KEY-----", r"\"private_key\"\s*:", r"sk-ant-[A-Za-z0-9\-]{10,}"]


def arquivos_versionaveis():
    try:
        out = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=RAIZ, text=True)
        return [RAIZ / l for l in out.splitlines() if l]
    except Exception:
        return [p for p in RAIZ.rglob("*") if p.is_file() and not any(x in p.parts for x in ("data", "secrets", ".venv", "node_modules", "artifacts", ".next"))]


def test_gitignore_protege_segredos_e_dados():
    gi = (RAIZ / ".gitignore").read_text(encoding="utf-8")
    for item in ("secrets/", ".env", "data/", "artifacts/"):
        assert item in gi


def test_nenhum_segredo_em_arquivo_versionavel():
    achados = []
    for p in arquivos_versionaveis():
        if "test_results" in p.parts:
            continue  # saídas do próprio pytest (ecoam as mensagens de falha)
        if p.suffix in (".png", ".jpg", ".mp4", ".mp3", ".parquet", ".ico", ".woff2") or not p.exists() or p.stat().st_size > 5_000_000:
            continue
        txt = p.read_text(encoding="utf-8", errors="ignore")
        for pad in PADROES:
            if re.search(pad, txt):
                achados.append(f"{p.relative_to(RAIZ)}: {pad}")
    assert not achados, achados


def test_nenhum_dado_pessoal_na_interface():
    for p in (RAIZ / "frontend" / "public" / "data").glob("*.json"):
        txt = p.read_text(encoding="utf-8", errors="ignore")
        assert "cc_num" not in txt and "dob" not in txt.lower().split('"') and "street" not in txt
