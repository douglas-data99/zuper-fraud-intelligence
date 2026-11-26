# Metodologia

## 1. Dados e qualidade (BigQuery)

**Bronze:** os dois CSVs originais, com SHA-256 conferido e índice exportado removido. Carga sem custo de consulta.

**Silver:**
- **Pseudonimização:** `card_key` = SHA-256 do número do cartão com sal secreto.
- **Dados pessoais:** removidos.
- **Coordenadas da casa:** arredondadas a cerca de 1 km.

**Qualidade** (`reports/metrics/qualidade_silver.json`):
- 0 duplicatas, 0 nulos;
- 44 empates no mesmo segundo, excluídos entre si nas janelas.

**Gold:** 20 features point-in-time. Toda janela é `RANGE BETWEEN W PRECEDING AND 1 PRECEDING` por cartão, ou seja, sem a própria transação e sem futuro. A feature global da loja usa só dias completos (D-30 a D-1).

**Validação:** um revisor independente recalculou em pandas e encontrou 0 divergências em 722.566 valores. O teste automatizado de paridade compara a SQL da Gold com a função online da API.

## 2. Divisão no tempo

| Janela | Uso |
|---|---|
| warmup | só histórico |
| train | treino |
| tuning | escolha do modelo |
| calibration | calibrador |
| policy | cortes |
| test | arquivo de teste original |

Cada janela tem uma função só. O teste é lido depois que modelo, calibrador, política e referência de drift estão salvos. O horário fica registrado em `congelado_antes_do_teste_em`.

## 3. Modelos

**Concorrentes:**
- Dummy (prior);
- Regressão Logística A e B: imputação com indicador e padronização, ajustadas só no treino, com `class_weight="balanced"`;
- Random Forest B: 300 árvores, profundidade 14, `balanced_subsample`;
- XGBoost A e B: `scale_pos_weight`, histograma, early stopping na janela de tuning, teto de 5.000 árvores (parou em 1.662);
- XGBoost B + Optuna: TPE, 25 trials, os 10 primeiros aleatórios.

**Escolha do Champion:** maior AP na janela de tuning. Não foi usado SMOTE: o peso de classe resolve sem criar exemplo artificial.

**Ablação:** A (só transação) contra B (+ histórico), mesmos parâmetros e mesmas linhas, deu AP 0,763 → 0,955.

## 4. Calibração

Isotônica e sigmoide foram ajustadas na janela calibration, e a escolha entre as duas foi feita pelo Brier na janela policy (venceu a sigmoide). O peso de classe infla o score bruto; a calibração corrige isso sem mudar a ordem, então a AUC não muda. Brier no teste: 0,000588 → 0,000551.

## 5. Política de decisão

O custo por transação é `custo_acao(a) + (1 − y)·atrito(a) + y·valor·(1 − eficácia(a))`:
- aprovar: tudo zero;
- autenticar: US$ 0,30 de custo, US$ 1 de atrito, eficácia de 70%;
- investigar: US$ 8 de custo, US$ 10 de atrito, eficácia de 95%;
- teto de 1% de investigação.

**Busca dos cortes:** força bruta em pares `t_auth ≤ t_review` sobre 3.748 candidatos (quantis mais todos os scores únicos do top 3%), com somas acumuladas, na janela policy. Uma força bruta independente com 7.445 candidatos achou o mesmo ótimo.

**Sensibilidade:** cada premissa foi multiplicada por 0,5 e por 2. O `t_review` varia de 0,029 a 0,63; o `t_auth` fica estável (verificar é barato).

## 6. Explicação

- **Explicação global:** SHAP com `pred_contribs` nativo do XGBoost, numa amostra de 20 mil transações do teste. Ela explica o **modelo bruto em log-odds**, e não é % de risco nem causalidade.
- **Explicação local:** a API calcula numa única passada e soma as contribuições para chegar ao log-odds. Um teste confere que a soma é igual à margem do modelo.

## 7. Monitoramento (replay)

**Replay:** o período de teste passa pela mesma lógica de produção, em ordem, com relógio virtual.

**Antes do rótulo:**
- PSI de score e de features contra a janela policy, com suavização e sem `hour`;
- distribuição de decisões e latência.

**Depois de 30 dias virtuais:**
- recall, precisão e recall em valor só da safra madura, com a cobertura informada;
- challenger (Random Forest) em modo sombra, com cortes próprios de mesma taxa de alerta. Ele nunca altera a decisão.
