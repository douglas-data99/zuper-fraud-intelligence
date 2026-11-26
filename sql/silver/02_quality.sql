-- Relatório de qualidade da Silver (uma linha por verificação).
SELECT 'linhas' AS verificacao, CAST(COUNT(*) AS STRING) AS valor FROM `{P}.{D}.silver_transactions`
UNION ALL SELECT 'tx_id_duplicado', CAST(COUNT(*) - COUNT(DISTINCT tx_id) AS STRING) FROM `{P}.{D}.silver_transactions`
UNION ALL SELECT 'nulos_chave', CAST(COUNTIF(tx_id IS NULL OR card_key IS NULL OR event_ts IS NULL OR amount_usd IS NULL) AS STRING) FROM `{P}.{D}.silver_transactions`
UNION ALL SELECT 'valor_nao_positivo', CAST(COUNTIF(amount_usd <= 0) AS STRING) FROM `{P}.{D}.silver_transactions`
UNION ALL SELECT 'cartoes', CAST(COUNT(DISTINCT card_key) AS STRING) FROM `{P}.{D}.silver_transactions`
UNION ALL SELECT 'colisao_hash_cartao', CAST((SELECT COUNT(DISTINCT cc_num) FROM `{P}.{D}.bronze_raw_transactions`) - COUNT(DISTINCT card_key) AS STRING) FROM `{P}.{D}.silver_transactions`
UNION ALL SELECT 'merchants', CAST(COUNT(DISTINCT merchant) AS STRING) FROM `{P}.{D}.silver_transactions`
UNION ALL SELECT 'empates_mesmo_cartao_mesmo_segundo', CAST(COUNT(*) AS STRING) FROM (
  SELECT card_key, ts_sec FROM `{P}.{D}.silver_transactions` GROUP BY 1, 2 HAVING COUNT(*) > 1)
UNION ALL SELECT 'perfis_com_mais_de_um_endereco', CAST(COUNTIF(n_enderecos > 1) AS STRING) FROM `{P}.{D}.silver_profiles`
UNION ALL SELECT 'maior_valor_fraude', CAST(MAX(IF(is_fraud = 1, amount_usd, NULL)) AS STRING) FROM `{P}.{D}.silver_transactions`
UNION ALL SELECT 'transacoes_acima_maior_fraude', CAST(COUNTIF(amount_usd > (SELECT MAX(IF(is_fraud = 1, amount_usd, NULL)) FROM `{P}.{D}.silver_transactions`)) AS STRING) FROM `{P}.{D}.silver_transactions`
