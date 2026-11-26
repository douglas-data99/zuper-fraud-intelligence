-- Visões sem duplicata: a carga em lote do worker é "pelo menos uma vez" (se cair entre a carga e o ACK,
-- o lote é recarregado). As análises devem ler estas visões, que mantêm a 1ª linha de cada tx_id.
CREATE OR REPLACE VIEW `{P}.{D}.v_predictions` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY tx_id ORDER BY processed_at) AS rn FROM `{P}.{D}.gold_predictions`
) WHERE rn = 1;

CREATE OR REPLACE VIEW `{P}.{D}.v_decisions` AS
SELECT * EXCEPT(rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY tx_id ORDER BY decided_at) AS rn FROM `{P}.{D}.gold_decisions`
) WHERE rn = 1;

-- Painel de auditoria: decisões e scores por dia virtual, já sem duplicata
CREATE OR REPLACE VIEW `{P}.{D}.v_auditoria_diaria` AS
SELECT DATE(p.event_ts) AS dia, p.origem, d.decision, COUNT(*) AS transacoes,
       ROUND(AVG(p.calibrated_score), 5) AS score_medio, ROUND(SUM(p.amount_usd), 2) AS volume_usd,
       ROUND(APPROX_QUANTILES(p.latency_ms, 100)[OFFSET(95)], 1) AS latencia_p95_ms,
       COUNTIF(d.decision != d.challenger_decision) AS divergencias_shadow
FROM `{P}.{D}.v_predictions` p JOIN `{P}.{D}.v_decisions` d USING (tx_id)
GROUP BY 1, 2, 3;
