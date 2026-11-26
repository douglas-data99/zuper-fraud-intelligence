-- GOLD: features point-in-time por transação.
-- Regra de ouro: toda janela termina em "1 segundo antes" da transação atual (RANGE ... AND 1 PRECEDING).
--   * a própria transação nunca entra no próprio histórico.
--   * transações do MESMO cartão no MESMO segundo não enxergam umas às outras (empates excluídos, documentado).
--   * nenhuma feature usa is_fraud (o rótulo só aparece na coluna label).
-- A feature global do merchant usa só dias completos anteriores (D-30 a D-1).
CREATE OR REPLACE TABLE `{P}.{D}.gold_training_features`
PARTITION BY DATE_TRUNC(event_date, MONTH)
CLUSTER BY card_key
AS
WITH base AS (
  SELECT t.*, p.home_lat, p.home_long
  FROM `{P}.{D}.silver_transactions` t
  JOIN `{P}.{D}.silver_profiles` p USING (card_key)
),
janela AS (
  SELECT
    tx_id, card_key, event_ts, ts_sec, event_date, merchant, category, amount_usd, is_fraud,
    EXTRACT(HOUR FROM event_ts)                                   AS hour,
    EXTRACT(DAYOFWEEK FROM event_ts) - 1                          AS weekday,     -- 0 = domingo
    ST_DISTANCE(ST_GEOGPOINT(home_long, home_lat), ST_GEOGPOINT(merch_long, merch_lat)) / 1000 AS distance_to_merchant_km,
    AVG(amount_usd)        OVER w7d   AS avg_amount_7d,
    AVG(amount_usd)        OVER w30d  AS avg_amount_30d,
    STDDEV_SAMP(amount_usd) OVER w30d AS std_amount_30d,
    COUNT(*)               OVER w30m  AS tx_count_30min,
    COUNT(*)               OVER w24h  AS tx_count_24h,
    COUNT(*)               OVER w7d   AS tx_count_7d,
    COUNT(*)               OVER w30d  AS tx_count_30d,
    IFNULL(SUM(amount_usd) OVER w24h, 0) AS sum_amount_24h,
    ts_sec - MAX(ts_sec)   OVER wall  AS time_since_last_tx_s,
    COUNT(*)               OVER wall  AS profile_history_count,
    COUNT(*) OVER (PARTITION BY card_key, merchant ORDER BY ts_sec RANGE BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS merchant_prev_count,
    COUNT(*) OVER (PARTITION BY card_key, category ORDER BY ts_sec RANGE BETWEEN 2592000 PRECEDING AND 1 PRECEDING) AS category_count_30d
  FROM base
  WINDOW
    wall AS (PARTITION BY card_key ORDER BY ts_sec RANGE BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
    w30m AS (PARTITION BY card_key ORDER BY ts_sec RANGE BETWEEN 1800 PRECEDING AND 1 PRECEDING),
    w24h AS (PARTITION BY card_key ORDER BY ts_sec RANGE BETWEEN 86400 PRECEDING AND 1 PRECEDING),
    w7d  AS (PARTITION BY card_key ORDER BY ts_sec RANGE BETWEEN 604800 PRECEDING AND 1 PRECEDING),
    w30d AS (PARTITION BY card_key ORDER BY ts_sec RANGE BETWEEN 2592000 PRECEDING AND 1 PRECEDING)
),
merchant_dia AS (   -- cartões distintos por merchant e dia
  SELECT DISTINCT merchant, event_date, card_key FROM `{P}.{D}.silver_transactions`
),
merchant_30d AS (   -- para cada merchant e dia D: cartões distintos de D-30 a D-1
  SELECT d.merchant, d.event_date, COUNT(DISTINCT m.card_key) AS merchant_distinct_cards_30d
  FROM (SELECT DISTINCT merchant, event_date FROM `{P}.{D}.silver_transactions`) d
  LEFT JOIN merchant_dia m
    ON m.merchant = d.merchant
   AND m.event_date BETWEEN DATE_SUB(d.event_date, INTERVAL 30 DAY) AND DATE_SUB(d.event_date, INTERVAL 1 DAY)
  GROUP BY 1, 2
)
SELECT
  j.tx_id, j.card_key, j.event_ts, j.event_date, j.merchant, j.category,
  j.amount_usd, j.hour, j.weekday, j.distance_to_merchant_km,
  j.avg_amount_7d, j.avg_amount_30d, j.std_amount_30d,
  SAFE_DIVIDE(j.amount_usd, j.avg_amount_30d)                       AS amount_vs_avg_30d,
  j.tx_count_30min, j.tx_count_24h, j.tx_count_7d, j.tx_count_30d,
  j.sum_amount_24h, j.time_since_last_tx_s,
  IF(j.merchant_prev_count = 0, 1, 0)                               AS is_new_merchant,
  SAFE_DIVIDE(j.category_count_30d, j.tx_count_30d)                 AS category_frequency_30d,
  IFNULL(m.merchant_distinct_cards_30d, 0)                          AS merchant_distinct_cards_30d,
  j.profile_history_count,
  CASE
    WHEN j.event_ts <  TIMESTAMP('2019-02-01')          THEN 'warmup'
    WHEN j.event_ts <  TIMESTAMP('2020-01-01')          THEN 'train'
    WHEN j.event_ts <  TIMESTAMP('2020-03-01')          THEN 'tuning'
    WHEN j.event_ts <  TIMESTAMP('2020-05-01')          THEN 'calibration'
    WHEN j.event_ts <  TIMESTAMP('2020-06-21 12:14:00') THEN 'policy'
    ELSE 'test'
  END                                                               AS split,
  j.is_fraud                                                        AS label,
  'v1'                                                              AS feature_version
FROM janela j
LEFT JOIN merchant_30d m USING (merchant, event_date);
