# Dicionário de dados e features

**Fonte:** Sparkov / *Credit Card Transactions Fraud Detection Dataset*, Kaggle `kartik2112/fraud-detection`, licença CC0-1.0. São transações de cartão **sintéticas**, geradas para os EUA. A moeda é o dólar (USD), e o fuso horário não é informado.

## Camadas no BigQuery (`zuper-fraud-intelligence.fraud_intelligence`)

| Tabela | Conteúdo | Partição / cluster |
|---|---|---|
| `bronze_raw_transactions` | Snapshot original. Sai o índice exportado; entram arquivo de origem, SHA-256 e data de ingestão | mês / cartão |
| `silver_transactions` | Sem dados pessoais. `card_key` = SHA-256 com sal secreto do número do cartão (16 hex). O prefixo artificial `fraud_` sai do nome da loja | mês / card_key |
| `silver_profiles` | Coordenadas da casa arredondadas a 2 casas (~1 km), para a distância | card_key |
| `gold_training_features` | 20 features point-in-time + split + rótulo | mês / card_key |
| `gold_customer_snapshot` | Estado de cada cartão no corte (21/06/2020 12:14): histórico, lojas vistas e últimos 30 dias | card_key |
| `gold_merchant_snapshot` | Cartões distintos por loja (D-30 a D-1 do corte) | — |
| `gold_predictions`, `gold_decisions` | Gravadas pelo worker: score bruto e calibrado, challenger, versões, motivos, latência | dia |
| `gold_fraud_labels`, `gold_monitoring` | Estrutura para rótulos confirmados e métricas por janela | dia |

**Excluídos de todo o modelo:** nome, sobrenome, sexo, rua, cidade, estado, CEP, profissão, data de nascimento, população da cidade, número do cartão, `trans_num` e o índice exportado.

## Features (versão v1)

| Feature | Grupo | Definição | Sem histórico |
|---|---|---|---|
| `amount_usd`, `log_amount` | A | valor e `log1p(valor)` | — |
| `category` (one-hot, 14) | A | categoria da loja | — |
| `hour`, `weekday` | A | hora e dia da semana (0 = domingo) no horário nominal do arquivo | — |
| `distance_to_merchant_km` | A | haversine entre a casa (arredondada) e a loja. Distância geográfica, não percorrida | — |
| `avg_amount_7d`, `avg_amount_30d` | B | média dos valores anteriores na janela | nulo |
| `std_amount_30d` | B | desvio amostral (precisa de 2 ou mais transações) | nulo |
| `amount_vs_avg_30d` | B | valor ÷ média de 30 dias | nulo |
| `tx_count_30min`, `_24h`, `_7d`, `_30d` | B | quantidade de transações anteriores na janela | 0 |
| `sum_amount_24h` | B | soma dos valores nas últimas 24 h | 0 |
| `time_since_last_tx_s` | B | segundos desde a transação anterior | nulo |
| `is_new_merchant` | B | 1 se o cartão nunca comprou nessa loja | 1 |
| `category_frequency_30d` | B | parcela das compras de 30 dias na mesma categoria | nulo |
| `merchant_distinct_cards_30d` | B | cartões distintos na loja de D-30 a D-1 (dias completos) | 0 |
| `profile_history_count` | B | tamanho do histórico anterior (confiabilidade e cold start) | 0 |

**Regras das janelas:**
- Uma transação passada `h` entra na janela `W` da transação `t` se `t − W ≤ h.ts ≤ t − 1 s`.
- A própria transação e as do mesmo cartão no mesmo segundo ficam de fora (44 casos na base).
- O rótulo nunca entra em nenhuma janela.
- Não há target encoding.

## Atalhos conhecidos do gerador

- **Teto de valor:** nenhuma fraude passa de US$ 1.376,04, e existem 2.299 transações legítimas acima disso.
- **Rajadas:** 976 dos 999 cartões têm fraude, em geral cerca de 10 fraudes em 2 dias.
- **Horário:** a taxa de fraude entre 22h e 3h é cerca de 18 vezes a do resto do dia.

Esses atalhos são medidos no experimento C (teste de estresse) e citados como limitação.
