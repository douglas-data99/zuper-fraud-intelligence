"""Roda o pytest e guarda a evidência: saída completa, versão, data, exit code e resultado por teste."""
from __future__ import annotations

import json
import platform
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SAIDA = RAIZ / "reports" / "test_results"
SAIDA.mkdir(parents=True, exist_ok=True)


def main():
    xml = SAIDA / "junit.xml"
    cmd = [sys.executable, "-m", "pytest", "tests", "-v", "-p", "no:cacheprovider", f"--junitxml={xml}"]
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True, encoding="utf-8", errors="replace")
    (SAIDA / "pytest_stdout.txt").write_text(proc.stdout + "\n" + proc.stderr, encoding="utf-8")
    casos = []
    for tc in ET.parse(xml).getroot().iter("testcase"):
        res = "passou"
        if tc.find("failure") is not None or tc.find("error") is not None:
            res = "FALHOU"
        elif tc.find("skipped") is not None:
            res = "pulado: " + (tc.find("skipped").get("message") or "")[:80]
        casos.append({"nome": f"{tc.get('classname').split('.')[-1]}::{tc.get('name')}", "resultado": res, "segundos": float(tc.get("time", 0))})
    resumo = {"data": time.strftime("%Y-%m-%d %H:%M:%S"), "python": platform.python_version(), "comando": " ".join(cmd[1:]),
              "exit_code": proc.returncode, "duracao_s": round(time.time() - t0, 1),
              "passaram": sum(c["resultado"] == "passou" for c in casos), "falharam": sum(c["resultado"] == "FALHOU" for c in casos),
              "pulados": sum(c["resultado"].startswith("pulado") for c in casos), "casos": casos}
    (RAIZ / "reports" / "metrics" / "teste_pytest.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(proc.stdout[-3000:])
    print(f"exit={proc.returncode} passaram={resumo['passaram']} falharam={resumo['falharam']} pulados={resumo['pulados']}")
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
