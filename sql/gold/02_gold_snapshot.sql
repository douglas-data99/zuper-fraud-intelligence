-- GOLD: snapshot do estado de cada cartão e de cada merchant no instante de corte do treino
-- (fim do arquivo de treino original, 2020-06-21 12:14:00). É o "presente" do simulador:
-- o Redis nasce deste snapshot e o replay do período de teste avança o relógio a partir daqui.
CREATE OR REPLACE TABLE `{P}.{D}.gold_customer_snapshot`
CLUSTER BY card_key
AS
WITH corte AS (SELECT TIMESTAMP('2020-06-21 12:14:00') AS ts),
hist AS (
  SELECT t.* FROM `{P}.{D}.silver_transactions` t, corte WHERE t.event_ts < corte.ts
)
SELECT
  h.card_key,
  p.home_lat, p.home_long,
  COUNT(*)                                             AS total_tx,
  ARRAY_AGG(DISTINCT h.merchant)                       AS merchants_vistos,
  ARRAY_AGG(IF(h.event_ts >= TIMESTAMP_SUB(c.ts, INTERVAL 30 DAY),
              STRUCT(h.ts_sec AS ts, CAST(h.amount_usd AS FLOAT64) AS amount, h.merchant AS merchant, h.category AS category),
              NULL) IGNORE NULLS ORDER BY h.ts_sec)     AS ultimas_30d,
  MAX(h.ts_sec)                                        AS snapshot_ts,
  APPROX_TOP_COUNT(h.category, 1)[OFFSET(0)].value     AS categoria_mais_comum,
  AVG(CAST(h.amount_usd AS FLOAT64))                   AS ticket_medio_historico,
  c.ts                                                 AS snapshot_corte
FROM hist h
JOIN `{P}.{D}.silver_profiles` p USING (card_key)
CROSS JOIN corte c
GROUP BY h.card_key, p.home_lat, p.home_long, c.ts;

-- merchants: cartões distintos de D-30 a D-1 em relação ao dia do corte (mesma regra da feature offline)
CREATE OR REPLACE TABLE `{P}.{D}.gold_merchant_snapshot` AS
SELECT
  merchant,
  APPROX_TOP_COUNT(category, 1)[OFFSET(0)].value                                 AS categoria,  -- 7 merchants têm 2 categorias na base: usa a mais frequente
  COUNT(DISTINCT IF(event_date BETWEEN DATE '2020-05-22' AND DATE '2020-06-20', card_key, NULL)) AS merchant_distinct_cards_30d
FROM `{P}.{D}.silver_transactions`
WHERE event_ts < TIMESTAMP('2020-06-21 12:14:00')
GROUP BY merchant;

-- tabelas operacionais (preenchidas pelo worker a partir do Redis Streams)
CREATE TABLE IF NOT EXISTS `{P}.{D}.gold_predictions` (
  tx_id STRING NOT NULL, card_key STRING, event_ts TIMESTAMP, amount_usd FLOAT64, merchant STRING, category STRING,
  raw_score FLOAT64, calibrated_score FLOAT64, challenger_score FLOAT64, model_version STRING, feature_version STRING,
  features JSON, origem STRING, latency_ms FLOAT64, processed_at TIMESTAMP
) PARTITION BY DATE(event_ts) CLUSTER BY card_key;

CREATE TABLE IF NOT EXISTS `{P}.{D}.gold_decisions` (
  tx_id STRING NOT NULL, decision STRING, challenger_decision STRING, policy_version STRING, t_auth FLOAT64, t_review FLOAT64,
  reasons JSON, origem STRING, decided_at TIMESTAMP
) PARTITION BY DATE(decided_at);

CREATE TABLE IF NOT EXISTS `{P}.{D}.gold_fraud_labels` (
  tx_id STRING NOT NULL, label INT64, event_ts TIMESTAMP, confirmed_at TIMESTAMP, fonte STRING
) PARTITION BY DATE(event_ts);

CREATE TABLE IF NOT EXISTS `{P}.{D}.gold_monitoring` (
  janela_inicio TIMESTAMP, janela_fim TIMESTAMP, model_version STRING, metrica STRING, valor FLOAT64,
  n INT64, cobertura_labels FLOAT64, gerado_em TIMESTAMP
) PARTITION BY DATE(gerado_em);
