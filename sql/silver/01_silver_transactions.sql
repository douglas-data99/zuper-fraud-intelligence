-- SILVER: transações limpas e pseudonimizadas.
-- Sai: nome, sobrenome, sexo, rua, cidade, estado, CEP, profissão, data de nascimento, população da cidade.
-- O número do cartão vira card_key (SHA-256 com sal secreto, 16 primeiros hex). O número completo nunca sai da Bronze.
CREATE OR REPLACE TABLE `{P}.{D}.silver_transactions`
PARTITION BY DATE_TRUNC(event_date, MONTH)
CLUSTER BY card_key
AS
SELECT
  trans_num                                                     AS tx_id,
  SUBSTR(TO_HEX(SHA256(CONCAT(@salt, cc_num))), 1, 16)          AS card_key,
  TIMESTAMP(trans_date_trans_time)                              AS event_ts,     -- fuso desconhecido: tratado como horário local nominal
  UNIX_SECONDS(TIMESTAMP(trans_date_trans_time))                AS ts_sec,
  DATE(TIMESTAMP(trans_date_trans_time))                        AS event_date,
  REGEXP_REPLACE(merchant, r'^fraud_', '')                      AS merchant,     -- todo merchant do gerador tem o prefixo "fraud_": artefato, removido
  category,
  CAST(amt AS NUMERIC)                                          AS amount_usd,
  merch_lat, merch_long,
  CAST(is_fraud AS INT64)                                       AS is_fraud,
  source_file
FROM `{P}.{D}.bronze_raw_transactions`;

-- Perfis: só o necessário para a feature de distância, com coordenadas arredondadas (~1 km).
CREATE OR REPLACE TABLE `{P}.{D}.silver_profiles`
CLUSTER BY card_key
AS
SELECT
  SUBSTR(TO_HEX(SHA256(CONCAT(@salt, cc_num))), 1, 16)          AS card_key,
  ROUND(ANY_VALUE(lat), 2)                                      AS home_lat,
  ROUND(ANY_VALUE(long), 2)                                     AS home_long,
  COUNT(DISTINCT CONCAT(CAST(ROUND(lat, 4) AS STRING), ',', CAST(ROUND(long, 4) AS STRING))) AS n_enderecos,
  MIN(TIMESTAMP(trans_date_trans_time))                         AS first_seen
FROM `{P}.{D}.bronze_raw_transactions`
GROUP BY 1;
