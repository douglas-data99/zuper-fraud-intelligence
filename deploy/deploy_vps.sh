#!/usr/bin/env bash
# Publica a stack na VPS em /opt/zuper-fraud (projeto Compose isolado "zuper-fraud").
# NÃO mexe em outros contêineres. Só acrescenta um bloco ao Caddyfile (com backup) e recarrega o Caddy sem reiniciar.
# Uso: bash deploy/deploy_vps.sh <host_api>   ex.: api-fraude.zuperdata.com.br
set -euo pipefail
HOST_API="${1:?informe o host público da API}"
VPS="${VPS:?defina VPS=usuario@host}"
KEY="${KEY:?defina KEY=caminho da chave SSH}"
CADDYFILE="${CADDYFILE:?defina CADDYFILE=caminho do Caddyfile na VPS}"
CADDY="${CADDY:?defina CADDY=nome do contêiner do Caddy}"
DEST="/opt/zuper-fraud"
cd "$(dirname "$0")/.."

test -f .env.vps || { echo "faltando .env.vps"; exit 1; }
test -f secrets/gcp-fraud-pipeline.json || { echo "faltando chave da conta de serviço"; exit 1; }

echo "== enviando arquivos"
tar czf - backend/Dockerfile backend/requirements.txt backend/app docker-compose.yml .env.vps \
  artifacts/model_bundle artifacts/mlflow data/serving secrets/gcp-fraud-pipeline.json \
  | ssh -i "$KEY" "$VPS" "mkdir -p $DEST && tar xzf - -C $DEST && chmod 600 $DEST/.env.vps $DEST/secrets/gcp-fraud-pipeline.json && chown -R 10001 $DEST/artifacts/mlflow || true"

echo "== subindo contêineres (limites de memória no compose)"
ssh -i "$KEY" "$VPS" "cd $DEST && docker compose up -d --build --remove-orphans && docker compose ps"

echo "== carregando snapshot no Redis"
ssh -i "$KEY" "$VPS" "cd $DEST && docker compose run --rm loader"

echo "== Caddy: bloco novo (backup antes), validação e reload"
ssh -i "$KEY" "$VPS" "set -e; F=$CADDYFILE; cp \$F \$F.bak-\$(date +%Y%m%d%H%M%S);
  if ! grep -q 'zuper-fraud' \$F; then printf '\n# Zuper Fraud Intelligence (/opt/zuper-fraud), desde 26/11/2026\n%s {\n\tencode gzip\n\treverse_proxy zfi-api:8000\n}\n' '$HOST_API' >> \$F; fi;
  docker exec $CADDY caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile &&
  docker exec $CADDY caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile"

echo "== teste"
curl -fsS "https://$HOST_API/health" && echo
