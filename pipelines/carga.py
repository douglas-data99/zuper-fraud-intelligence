"""Teste de carga simples: N requisições what-if com concorrência C contra a API. Mede ponta a ponta e o tempo interno.

Uso: python carga.py <url_api> <n> <concorrencia> "<condições>"
Não extrapolar: o resultado vale só para a máquina e a amostra declaradas.
"""
from __future__ import annotations

import asyncio
import json
import random
import sys
import time

import httpx
import numpy as np

import os

from common import RAIZ, RELATORIOS

TOKEN = next((l.split("=", 1)[1].strip() for l in (RAIZ / ".env.vps").read_text().splitlines() if l.startswith("ADMIN_TOKEN=")), "")


async def main(url, n, conc, condicoes):
    async with httpx.AsyncClient(base_url=url, timeout=30) as cli:
        perfis = (await cli.get("/profiles?limite=200")).json()
        lojas = (await cli.get("/merchants")).json()
        rnd = random.Random(42)
        corpos = [{"card_key": rnd.choice(perfis)["card_key"], "merchant": rnd.choice(lojas)["merchant"],
                   "amount_usd": round(rnd.uniform(2, 1500), 2), "hora": rnd.randint(0, 23),
                   "local": rnd.choice(["perto_de_casa", "cidade_vizinha", "outro_estado"])} for _ in range(n)]
        sem = asyncio.Semaphore(conc)
        e2e, interno, erros = [], [], 0

        async def uma(b):
            nonlocal erros
            async with sem:
                t0 = time.perf_counter()
                try:
                    r = await cli.post("/transactions/score", json=b, headers={"Authorization": f"Bearer {TOKEN}"})
                    e2e.append((time.perf_counter() - t0) * 1000)
                    if r.status_code != 200:
                        erros += 1
                    else:
                        interno.append(r.json()["latency_ms"])
                except Exception:
                    erros += 1

        t0 = time.perf_counter()
        await asyncio.gather(*(uma(b) for b in corpos))
        total = time.perf_counter() - t0
    p = lambda a, q: round(float(np.percentile(a, q)), 1) if a else None
    res = {"data": time.strftime("%Y-%m-%d %H:%M"), "alvo": url, "requisicoes": n, "concorrencia": conc,
           "p50_ms": p(e2e, 50), "p95_ms": p(e2e, 95), "p99_ms": p(e2e, 99),
           "interno_p50_ms": p(interno, 50), "interno_p95_ms": p(interno, 95),
           "rps": round(n / total, 1), "taxa_erro": erros / n, "condicoes": condicoes,
           "aviso": "amostra pequena; não indica capacidade de produção"}
    (RELATORIOS / "metrics" / "carga.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]))
