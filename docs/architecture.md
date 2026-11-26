# Arquitetura

```mermaid
flowchart TD
  A[Sparkov CSV, CC0, SHA-256 conferido] -->|load job, sem custo de consulta| B[(BigQuery Bronze)]
  B -->|SQL: pseudonimização e qualidade| C[(Silver)]
  C -->|SQL: janelas point-in-time| D[(Gold: features de treino)]
  C -->|SQL: estado no corte| S[(Gold: snapshot cartão e loja)]
  D -->|Storage Read API, Parquet| E[Treino Python: Dummy, LR, RF, XGBoost, Optuna]
  E --> F[MLflow: tracking e registry, aliases champion/challenger]
  E --> G[Bundle congelado: modelo, calibrador, schema, política]
  S -->|loader| R[(Redis: perfis e lojas)]
  H[Next.js na Vercel] -->|HTTPS| I[FastAPI na VPS]
  R -->|GET em O(1)| I
  G -->|carregado uma vez em memória| I
  I -->|decisão síncrona| H
  I -->|XADD| X[[Redis Streams]]
  P[Replay com relógio virtual] -->|XADD| X
  X -->|consumer group, ACK após persistir| W[Worker Python]
  W -->|WATCH/MULTI| R
  W -->|load job em lote| O[(Gold: predictions, decisions)]
  P --> M[Monitoramento: PSI, safra madura, shadow]
  M --> H
```

## Caminho síncrono (pagamento)

1. A API recebe `POST /transactions`. O Pydantic valida: valor > 0 e ≤ US$ 30 mil, `card_key` hexadecimal de 16 caracteres, hora de 0 a 23, local numa lista fechada.
2. Faz `GET fraud:profile:{card}` e `GET fraud:merchant:{loja}` no Redis. O navegador **nunca** envia histórico.
3. Calcula as features em `backend/app/features.py`. É a mesma regra do SQL da Gold, conferida por um teste de paridade.
4. Roda o XGBoost (já em memória) e o calibrador, e aplica a política de 3 níveis.
5. Calcula as contribuições SHAP com `pred_contribs` nativo do XGBoost, sem chamar a biblioteca SHAP no caminho crítico.
6. Calcula o score do challenger em modo sombra. Ele é registrado e nunca aplicado.
7. Publica o evento no Redis Streams e responde. **O BigQuery não entra no caminho síncrono.**

## Caminho assíncrono

- **Leitura:** o worker lê o stream pelo grupo `persistencia`.
- **Histórico:** atualiza o histórico do cartão com WATCH/MULTI (concorrência otimista).
- **Persistência:** grava no BigQuery em lote (load job) e só então dá ACK.
- **Falha:** se o worker cai antes do ACK, a mensagem fica pendente e outro worker a retoma com `XAUTOCLAIM`.
- **Idempotência:** o mesmo `tx_id` nunca é aplicado duas vezes (`SET NX` na API e `SADD` no worker).
- **O que entra no histórico:**
  - transações aprovadas e autenticadas entram nas features de velocidade;
  - as retidas para investigação ficam fora (não foram autorizadas) e são contadas em `fraud:tentativas_retidas`.

## Por que não Kafka, Spark ou Cloud Run

- **Volume:** é de demonstração. O Redis Streams entrega o mesmo modelo de consumo (grupo, ACK, reentrega) com uma fração da memória.
- **VPS:** já existe e é compartilhada (2 vCPU, 3,7 GB). Cada contêiner tem limite de memória e CPU, para não afetar o WhatsApp em produção que roda ao lado.
- **Migração:** Kafka + Flink/Spark é o caminho quando houver partições, reprocessamento histórico e várias equipes consumindo eventos (roadmap).

## Segurança

- **Redis:** sem porta pública.
- **MLflow:** só em `127.0.0.1` (acesso por túnel SSH).
- **API:** publicada pelo Caddy existente, com HTTPS automático. Tem rate limit (120 por minuto por IP), CORS restrito e erro explícito sem detalhe interno.
- **Rotas `/admin/*`:** exigem token.
- **Conta de serviço do BigQuery:** papéis mínimos (`jobUser`, `dataEditor` no projeto exclusivo e `readSessionUser`). A chave é montada em runtime e nunca vai para o git.
- **Custo do Google Cloud:** projeto exclusivo, cota de 20 GiB de consulta por dia, `maximum_bytes_billed` em toda consulta e orçamento de R$ 50 com alertas.

## Rollback

- **Bundle:** cada bundle é imutável e versionado (data do treino e hash do dataset no `feature_schema.json`).
- **Promoção:** troca o alias `champion` no MLflow Registry e monta a pasta do bundle aprovado.
- **Volta:** apontar o volume `model_bundle` para a versão anterior e `docker compose up -d api`. O healthcheck valida a subida.
- **Limite:** nesta entrega só existe uma versão aprovada, por isso o endpoint de rollback responde que não há versão anterior.
