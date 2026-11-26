# Zuper Fraud Intelligence: comandos reprodutíveis (Python do .venv; no Windows use Git Bash).
PY ?= .venv/Scripts/python
ifeq ($(OS),)
PY = .venv/bin/python
endif

ingest:      ## baixa nada: confere checksum dos CSVs em data/raw e carrega a Bronze no BigQuery
	cd pipelines && ../$(PY) ingest.py
features:    ## Silver + Gold no BigQuery e exporta a Gold para Parquet
	cd pipelines && ../$(PY) build_features.py
snapshot:    ## snapshot de perfis/lojas (Redis) + fluxo de replay
	cd pipelines && ../$(PY) snapshot.py
train:       ## treino, comparação, calibração, política, avaliação final e MLflow (precisa do MLflow em 127.0.0.1:5005)
	cd pipelines && PYTHONUTF8=1 ../$(PY) train.py
mlflow:      ## servidor MLflow local
	cd artifacts/mlflow && ../../.venv/Scripts/mlflow server --host 127.0.0.1 --port 5005 --backend-store-uri sqlite:///mlflow.db --artifacts-destination ./artifacts --serve-artifacts
test:        ## testes (Redis de teste: docker run -d -p 127.0.0.1:6390:6379 redis:7.4-alpine)
	$(PY) pipelines/rodar_testes.py
up:          ## sobe Redis + API + worker + replay + MLflow (docker compose)
	docker compose up -d --build
load:        ## carrega o snapshot no Redis do compose
	docker compose exec api python -m app.loader /app/serving --redis redis://redis:6379/0
demo:        ## interface local
	cd frontend && npm run sync-data && npm run dev
