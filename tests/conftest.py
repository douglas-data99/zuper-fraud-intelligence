import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "pipelines"))
os.environ.setdefault("BUNDLE_DIR", str(RAIZ / "artifacts" / "model_bundle"))
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6390/0")   # Redis de teste dedicado (docker), nunca o de produção
os.environ.setdefault("ADMIN_TOKEN", "token-de-teste")
