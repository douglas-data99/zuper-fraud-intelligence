# Relatório de execução para revisão: Zuper Fraud Intelligence

**Para:** o revisor (ChatGPT), que escreveu a especificação `ESPECIFICACAO.md` (v1.0, 26/11/2026), e o Douglas.
**De:** Claude Code (Opus 5.5). A execução foi contínua, entre 26/11/2026 03:50 e cerca de 07:30, com o Douglas dormindo durante quase todo o tempo.
**Como usar:** cada seção segue a numeração da especificação. Para cada item há quatro partes: o que foi feito, a lógica, o que mudou em relação ao desenho e o que ficou de fora. As dúvidas e pedidos de revisão estão no fim.

---

## 0. Resumo executivo

- **No ar:**
  - aplicação Next.js com 5 páginas na Vercel;
  - API FastAPI na VPS (Hetzner, compartilhada), com Redis, Redis Streams, worker, replay e MLflow privado;
  - dados e features no BigQuery, num projeto exclusivo com teto de R$ 50;
  - 3 repositórios públicos no GitHub;
  - portfólio no ar com os 2 projetos de fraude.
- **Números do teste** (arquivo de teste original Sparkov, 555.719 transações, 2.145 fraudes, política congelada antes):
  - **Champion XGBoost:** AP 0,9583, ROC-AUC 0,9990, recall 98,1% com 0,5% de FPR.
  - **Ablação (mesmas linhas):** só transação dá AP 0,763; com histórico de comportamento, AP 0,955.
  - **Política de 3 níveis:** aprova 99,18%, verifica 0,30%, investiga 0,52%. Sinaliza 99,3% do valor fraudado. Benefício líquido simulado de US$ 1,03 mi contra aprovar tudo. Custa 11% menos que 1 corte.
  - **Estresse:** sem features de valor, AP 0,538. O resultado é um teto otimista, por causa dos atalhos do gerador.
- **Processo:**
  - 5 etapas, cada uma validada por um agente revisor independente;
  - **duas etapas foram reprovadas na 1ª rodada** e corrigidas;
  - 41 testes automatizados passando;
  - diário completo em `docs/DIARIO.md`.

---

## 1. Missão e posicionamento: cumprido

- **Nome:** Zuper Fraud Intelligence, identificado em toda tela, README e vídeo como "projeto de portfólio, dados sintéticos públicos, sem ligação com banco real".
- **Benchmark:** **não foi citado** na interface pública, no README nem no repositório. A própria especificação (que cita o benchmark) ficou **fora do repositório público**, no `.gitignore`. Nada do benchmark foi copiado: nem PaySim, nem código, nem texto. A estrutura de custos é diferente: USD, com atrito separado do custo de ação, e eficácia por ação.
- **Diferenciais da seção 1.1, como ficaram:**

| Diferencial | Situação |
|---|---|
| Histórico comportamental | ✅ 14 features point-in-time, ablação medida |
| Jornada de pagamento integrada | ✅ simulador, API e stream |
| Calibração | ✅ |
| BigQuery | ✅ |
| Redis | ✅ |
| MLOps funcional | ✅ |
| Rastreabilidade | ✅ |

## 2. Restrições e arquitetura

**Inspeção antes de instalar.** Antes de qualquer instalação, inspecionei a VPS: 2 vCPU, 3,7 GB, com Evolution (WhatsApp) e `midia` em produção. A partir disso:
- criei o projeto Compose `zuper-fraud` em `/opt/zuper-fraud`;
- cada serviço tem limite de memória e CPU;
- não houve porta pública: a API escuta em 127.0.0.1 e é publicada pelo Caddy existente (bloco novo, com backup do Caddyfile e reload sem restart);
- o MLflow fica só em 127.0.0.1, acessível por túnel SSH.

**Desvio 1: treino no computador do Douglas, não na VPS.**
- **Por quê:** a VPS tinha 2,4 GB livres, junto com o WhatsApp em produção. O treino usou cerca de 4,6 GB de RAM.
- **Consequência:** a especificação diz "nada deve depender do PC ligado". O serviço não depende, porque o bundle foi para a VPS. O retreino, sim, depende hoje de uma máquina maior.

**Desvio 2: GCP.**
- O Douglas definiu que a conta Google da Zuper é `douglasexcel4job@gmail.com`.
- Criei o projeto exclusivo `zuper-fraud-intelligence` e uma conta de serviço com os papéis `bigquery.jobUser`, `bigquery.dataEditor` e `bigquery.readSessionUser`.
- **A chave da conta de serviço foi criada pelo próprio Douglas,** porque o classificador de segurança me bloqueou essa ação.

**Trava de custo:**
- orçamento de R$ 50, com alertas;
- cota de consulta de 20 GiB/dia (é o que **de fato bloqueia** o gasto, já que o orçamento só avisa);
- `maximum_bytes_billed` em toda consulta, com dry run;
- **regra do Douglas:** o modelo não treina nem é testado no BigQuery;
- **consumo real:** cerca de 1,5 GiB faturado em 24 consultas, dentro da faixa grátis.

**Segurança:**
- segredos fora do git, conferidos por teste;
- MLflow e Redis privados;
- rotas `/admin` com token;
- rate limit;
- CORS restrito;
- validação Pydantic com `extra="forbid"`;
- erro explícito, sem detalhe interno.

**Serviços não usados**, documentados como alternativa futura: Kafka, Spark, Cloud Run, Cloud Functions e Supabase.

## 3. Dados

- **Sparkov:** 1.852.394 linhas, licença CC0, SHA-256 registrado. Moeda USD; fuso horário desconhecido (hora usada como está).
- **Cartão:** virou `card_key`, um SHA-256 com sal secreto. Nenhum dado pessoal entra no modelo.
- **Atalhos do gerador**, documentados:
  - teto de US$ 1.376 nas fraudes;
  - rajadas, com 976 de 999 cartões tendo fraude;
  - cartões só de fraude;
  - horário noturno (das 22h às 3h, a taxa é 18 vezes maior).
- **7 merchants têm 2 categorias** na base. O snapshot usa a mais frequente.
- **Dúvida para revisão:** a especificação pede "não tratar como Pix". Isso foi cumprido: a interface fala em "pagamento", com cartão fictício.

## 4. Jornada do produto (5 páginas)

**Página 1, Centro de operações:**
- KPIs com período, fonte e selo ("teste histórico", "replay", "ao vivo", "premissa");
- funil por ação, série diária, resultado financeiro separado em perda residual, custo operacional, atrito e benefício;
- "N/D" quando não há dado.

**Página 2, Simulador:**
- celular virtual e painel do histórico, lido do Redis;
- 3 cenários reproduzíveis, selecionados por what-if real e sem forçar resultado;
- what-if sem gravação × transação com evento;
- motivos SHAP em log-odds;
- trilha de tempos reais (lookup, features, inferência, publicação e persistência assíncrona);
- shadow;
- comparação contrafactual rotulada como "não causal";
- confirmação fictícia identificada.

**Página 3, Motor de decisão:**
- simulador de 2 cortes e 6 premissas, na **janela policy** (validação), nunca no teste;
- otimizador no navegador;
- matriz de confusão, F1 e curva PR com o ponto operacional;
- tabela da política congelada no teste, não ajustável;
- sensibilidade.

**Página 4, Data Science Lab:**
- protocolo, comparação dos 7 modelos, curvas PR e ROC, calibração, SHAP, estresse, segmentos, qualidade e limitações;
- tudo carregado de artefatos gerados pela execução.

**Página 5, MLOps:**
- arquitetura com estado ao vivo;
- modelos (champion e challenger);
- PSI, safra madura, latência, evidência dos testes, prints do MLflow e roadmap.

**Não feito:**
- Plotly entrou como biblioteca da interface, mas a curva de calibração e o SHAP estático também existem como PNG;
- não há tela de "trocar política ao vivo na API", porque a política é congelada e versionada.

## 5. Engenharia de dados

**Camadas:**

| Camada | Tabelas |
|---|---|
| Bronze | `bronze_raw_transactions` |
| Silver | `silver_transactions`, `silver_profiles` |
| Gold | `gold_training_features`, `gold_customer_snapshot`, `gold_merchant_snapshot`, `gold_predictions`, `gold_decisions`, `gold_fraud_labels`, `gold_monitoring` |

**Partição e cluster:** partição por mês ou dia e cluster por `card_key`.

**Visões** (adicionadas depois da revisão E3-E5):
- `v_predictions` e `v_decisions`, sem duplicata, porque a carga é "pelo menos uma vez";
- `v_auditoria_diaria`, com decisões, score médio, latência p95 e divergência do shadow.

**Features (seção 5.1):** entraram todas as da tabela. Somei também:
- `std_amount_30d`;
- `tx_count_30d`;
- `log_amount`.

**Regras da janela:** `RANGE … AND 1 PRECEDING`; empates no mesmo segundo excluídos (44 casos); o rótulo nunca entra; sem target encoding; agregados de fraude por merchant **omitidos**, porque não há rótulo confirmado com data.

**Redis:**
- perfil por cartão, com o histórico de 30 dias, o total e as lojas vistas;
- loja;
- idempotência;
- stream limitado;
- TTL;
- `volatile-ttl`.

**Política de feature ausente:** cartão desconhecido dá 404, loja desconhecida dá 422 e Redis fora do ar dá 503. **Nunca aprova por padrão.**

**Tentativa × autorizada:**
- aprovadas e autenticadas entram no histórico;
- as retidas para investigação ficam fora e são contadas à parte.

**Dúvida:** autenticação aprovada deveria entrar só depois da confirmação do cliente?

## 6. Protocolo científico

1. **EDA e qualidade:** prevalência por mês, valores, categorias e atalhos.
2. **Janelas:**

| Janela | Período | Uso |
|---|---|---|
| warmup | 2019-01 | só histórico |
| train | 2019-02 a 12 | treino |
| tuning | 2020-01 a 02 | early stopping e Optuna |
| calibration | 2020-03 a 04 | calibrador |
| policy | 2020-05 até 21/06 | cortes |
| test | arquivo original | avaliação final |

   O código verifica que não há sobreposição e que as duas classes aparecem em toda janela.
3. **Modelos:** Dummy, LR A/B, RF B, XGB A/B e XGB B + Optuna. Peso de classe, sem SMOTE. Isolation Forest não entrou: é opcional e já foi feito no projeto BAF.
4. **Experimentos de features:**
   - A × B sobre as mesmas linhas;
   - C1: sem valor;
   - C2: sem valor e sem rajada;
   - C3: Champion abaixo de US$ 800;
   - C4: sem histórico curto.
5. **XGBoost:**
   - todos os hiperparâmetros registrados;
   - Optuna TPE com 25 trials, os 10 primeiros aleatórios;
   - early stopping no tuning, parando em 1.662 árvores com teto de 5.000;
   - **o Optuna empatou** (+0,003 de AP no teste), e isso é declarado.
6. **Calibração:** sigmoide × isotônica, ajustadas em calibration e escolhidas em policy. Brier e curva de confiabilidade antes e depois. O bundle guarda o calibrador.
7. **Métricas:** AP e PR-AUC por trapézio reportadas como coisas diferentes; recall com 0,5% e 1% de FPR; F1, precisão e recall nos cortes; taxa de alerta; recall em valor; prevalência como linha de base.
8. **SHAP:** `pred_contribs` nativo, explicando o modelo bruto em log-odds. A API calcula numa passada só, e o score bruto é derivado da soma das contribuições (diferença de 6e-8, testada).
9. **Congelamento:** modelo, calibrador, schema, política, hash do dataset, git, hash do código e referência de drift salvos **antes** do teste.

**Ponto crítico de honestidade: o teste foi lido 3 vezes** (`reports/metrics/leituras_do_teste.json`):
1. ensaio de depuração;
2. execução final;
3. reexecução por bugs apontados pela revisão E2.

Nenhuma escolha foi feita a partir do teste. **Peço sua avaliação sobre isso.**

## 7. Política financeira

- **Custo por transação:** `custo_acao + (1−y)·atrito + y·valor·(1−eficácia)`.
- **Premissas (USD):**

| Ação | Custo | Atrito com cliente legítimo | Eficácia |
|---|---:|---:|---:|
| aprovar | 0 | 0 | 0 |
| autenticar | 0,30 | 1 | 70% |
| investigar | 8 | 10 | 95% |

  Com teto de 1% de investigação.
- **Otimização:** força bruta em pares com somas acumuladas. A grade é densa na cauda (3.748 candidatos) depois que a revisão E2 achou a grade de 300 quantis grossa demais.
- **Sensibilidade:** cada premissa vezes 0,5 e vezes 2. O `t_review` varia de 0,029 a 0,63; o `t_auth` fica estável.
- **Comparações:** contra "aprovar tudo" e contra 1 corte.
- **Valores reportados separadamente:** valor sinalizado, potencialmente evitado e benefício líquido.
- **Não implementado:** política por valor esperado de cada transação (E[C(a)] com o p calibrado), que é opcional na especificação.

## 8. API

- **Endpoints:** `/health`, `/profiles`, `/profiles/{id}`, `/merchants`, `/scenarios`, `POST /transactions/score` (what-if), `POST /transactions` (idempotente, exige `tx_id`), `GET /transactions/{id}`, `/metrics`, `/models`, `/architecture/status`, `/admin/replay`, `/admin/model/rollback` (stub documentado).
- **Resposta:** todos os campos da seção 8, mais a trilha de etapas, o shadow e as features.
- **Erros:** 404, 422 e 503 explícitos; a liberação do `txlock` quando a publicação falha.
- **Rate limit:** usa o último IP do XFF. Eu achei e corrigi um bug de IP forjável.

## 9. MLOps e monitoramento

- **MLflow:** 19 runs, registry `zuper-fraud-xgb` (v1 substituída e descrita, v2 com alias champion) e `zuper-fraud-rf` (challenger).
- **Promoção:** manual. Rollback documentado, mas não demonstrado ao vivo.
- **Replay com relógio virtual** na VPS (10 eventos/s nominais, cerca de 3 efetivos por limite de CPU):
  - rótulos liberados em D+30 virtual;
  - safra madura agregada em contadores;
  - PSI com janela de 20 mil eventos, sem `hour`;
  - shadow com cortes de mesma taxa de alerta.
- **Não feito:**
  - simulação de mudança de distribuição em produção (o parâmetro `deriva_valor` existe e é testado, mas não foi rodado ao vivo);
  - A/B e canary (roadmap);
  - retreino agendado.

## 10. Gates P0, P1 e P2

| Bloco | Situação |
|---|---|
| P0 | completo |
| P1 | completo |
| P2 | shadow ✅, drift ✅, rótulos atrasados ✅, teste de carga ✅, estresse ✅ (C1 a C4), RF ✅; rollback ao vivo ❌; Isolation Forest ❌ (está no projeto BAF) |

## 11. Repositório

A estrutura segue a sugerida, com estas adaptações:
- `backend/app` também contém `loader`, `worker` e `replay`;
- `tools/` guarda os prints;
- `video/` guarda a apresentação.

Comandos `make`: ingest, features, snapshot, train, mlflow, test, up, load e demo.

## 12. Testes e evidências (41 passando)

**Cobertos:**
- schema e qualidade;
- split;
- point-in-time (evento futuro não muda feature passada);
- vazamento;
- paridade offline × online (300 transações × 15 features, 0 divergência);
- cold start;
- thresholds (bordas e ordem);
- motor de custo (conta manual + otimizador = força bruta);
- calibrador;
- round-trip do bundle (AP com tolerância de 1e-9);
- API 200/422/404/503;
- idempotência;
- stream com ACK e recuperação (XAUTOCLAIM);
- DLQ;
- marcador atômico;
- shadow;
- rótulo atrasado;
- drift (perturbação controlada);
- rate limit forjado;
- segredos fora do git.

**Não coberto:** teste de interface ponta a ponta automatizado. Foi substituído por prints reais navegando no site no ar (`tools/prints.mjs`), que é inspeção manual, não teste.

**Carga:** 300 requisições, 4 simultâneas, contra a produção: 7,5 req/s, p50 de 512 ms ponta a ponta Brasil→Helsinque, p50 interno de 230 ms, 0% de erro. Com as condições declaradas.

---

## 13. Desafios, erros e incidentes (em ordem)

1. **Funções do BestByBrasil apagadas por engano (antes do projeto).** Um comando foi interrompido tarde. As 9 funções foram recriadas, com o código e a configuração exatos do log de auditoria. Registro em `bbb-agente/base/docs/RECRIACAO-FUNCOES-2026-11-26.md`.
2. **Ferramentas:**
   - o CLI do Kaggle estava quebrado;
   - o `dbdate` do Parquet não era reconhecido;
   - o SQLAlchemy era antigo demais para o MLflow;
   - o console do Windows quebrava com emoji (cp1252);
   - comentário SQL com ";" quebrava o separador de comandos;
   - o `create-next-app` travou numa pergunta interativa, e o `npm install` caiu na raiz (os arquivos criados foram apagados);
   - a Vercel recusou o Next 15.3.3 por vulnerabilidade (atualizado para 15.5.29);
   - projeto Vercel criado sem framework, gerando 404.
3. **Bug do bundle (revisão E2):** o modelo salvo tinha 2.000 árvores, mas o avaliado usava 1.999 (best_iteration). A API servia algo diferente do medido.
4. **Grade de cortes grossa (revisão E2):** a sensibilidade não mexia em nada.
5. **INCIDENTE: a API resolveu o Redis do WhatsApp.**
   - **Causa:** a API estava na rede do Caddy, onde já existe um host `redis` (o da Evolution).
   - **Efeito:** apenas a chave `fraud:replay:comando` foi gravada lá, 2 vezes.
   - **Correção:** nomes únicos (`zfi-redis`, `zfi-api`).
   - **Pendente:** o classificador me bloqueou de limpar o Redis do WhatsApp; o Douglas pode remover a chave.
6. **Revisão E3-E5:**
   - o Redis encheria em cerca de 6 h;
   - o simulador mostrava o histórico de outro cartão;
   - update perdido no worker;
   - duplicatas no BigQuery;
   - mensagem envenenada em loop;
   - shadow comparado com o corte errado;
   - PSI acusando drift falso em `hour`;
   - nome genérico `api`.

   Todos corrigidos. Na 2ª rodada sobrou o Redis lotando em cerca de 25 h, corrigido com `volatile-ttl` e TTL de 6 h no replay.
7. **Rate limit burlável** pelo X-Forwarded-For. Eu mesmo achei, ao escrever o teste de carga.
8. **DNS:** zuperdata.com.br está na Hostinger, e eu não tinha acesso. A API e o site estão em endereços provisórios.
9. **Desempenho:** inferência de cerca de 80 ms numa VPS de 0,8 vCPU para a API. Tirei uma passada (score vindo da soma do SHAP). A capacidade real é modesta, e foi declarada assim.

## 14. Dúvidas e pedidos de revisão ao ChatGPT

1. **Leituras do teste:** ler o teste 3 vezes (1 ensaio, 1 final, 1 por bug) compromete a avaliação? Ou o registro em `leituras_do_teste.json` resolve? Vale manter um holdout extra, como dezembro de 2020?
2. **Atalhos da Sparkov:** o C1/C2 mostram forte dependência de valor e rajada. Para a entrevista, é melhor apresentar o Champion completo como "teto" ou dar mais destaque a um modelo "sem atalhos"?
3. **Custo das premissas:** os valores em USD (0,30 / 1 / 8 / 10, eficácia de 70% e 95%) parecem razoáveis como cenário? Sugere outra forma de apresentar (faixas, em vez de pontos)?
4. **Autenticação × histórico:** a transação autenticada deve entrar no histórico antes da confirmação do cliente?
5. **Optuna empatou.** Mantenho o Champion com Optuna (versionado) ou volto ao XGBoost base, por simplicidade?
6. **Estresse C4:** sem `profile_history_count` e `time_since_last`, AP 0,951. Confirma que o histórico curto não é o motor principal, apesar do segmento "frio" ser só fraude?
7. **O que falta para ficar acima do benchmark:** pela sua leitura, o que ainda falta em produto ou negócio?
8. **Vídeo:** feito para o Douglas entender o projeto, com cerca de 4 min 15 s e a voz clonada dele. Ele quer saber se o roteiro cobre o que um entrevistador vai perguntar.
