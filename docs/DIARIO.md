# Diário de execução: Zuper Fraud Intelligence

Registro contínuo de etapas, decisões, dúvidas e dificuldades. Ele serve de base para o relatório final que vai para revisão no ChatGPT (`docs/RELATORIO-PARA-REVISAO.md`).

## Decisões do Douglas (26/11/2026, noite)

- **Endereços:** site em `fraude.zuperdata.com.br` (Vercel); API em `api-fraude.zuperdata.com.br` (VPS, com um bloco novo no Caddy, sem mexer no que já existe). MLflow fica privado, acessível só por túnel SSH.
- **Publicação:**
  - repositórios públicos `douglas-data99/zuper-fraud-intelligence` e o estudo BAF (`deteccao-fraude-abertura-de-contas`);
  - portfólio no ar em `zuperdata.com.br/douglas-portifolio`, com os dois projetos de fraude cadastrados.
- **Vídeo:** para o próprio Douglas entender o projeto inteiro (não é para a entrevista). Robusto, no estilo dos vídeos das redes: prints estratégicos e motion. Voz clonada "Douglas profissional" (ElevenLabs). Pode ser hospedado no Git.
- **Execução:** sequencial, de A a Z. Cada etapa é validada por um agente revisor antes de seguir. O foco é comercial e analítico, e o projeto deve ser superior ao benchmark nas partes de negócio, engenharia e produto, sem copiar nada.
- **Custo:**
  - BigQuery limitado a R$ 50 no projeto `zuper-fraud-intelligence`, com cota de 20 GiB/dia;
  - o modelo **não** roda no BigQuery;
  - BestByBrasil com custo zero (agendamentos pausados);
  - Zupfy encerrado.

## Plano de etapas

| # | Etapa | Validação |
|---|---|---|
| E1 | Dados: download do Sparkov, checksum, EDA, Bronze/Silver/Gold no BigQuery, features point-in-time | agente revisor |
| E2 | Modelagem: splits, Dummy/LR/XGB/RF, ablação A×B, calibração, SHAP, política de custo em 3 níveis, MLflow | agente revisor |
| E3 | API FastAPI + Redis + Streams + worker + persistência no BigQuery + testes | agente revisor |
| E4 | Interface Next.js com 5 páginas | agente revisor |
| E5 | Deploy: VPS (Compose, Caddy, DNS) e Vercel | agente revisor |
| E6 | Testes finais, teste de carga, prints, documentação, roteiro de entrevista | agente revisor |
| E7 | Vídeo de cerca de 5 min com a voz do Douglas | revisão |
| E8 | Publicação: GitHub, portfólio no ar | conferência |
| E9 | Relatório para revisão no ChatGPT | — |

## Log

(entradas abaixo, mais recentes no fim)

### E1: Dados (26/11/2026, madrugada)
- **Sparkov baixado pela API do Kaggle.** Licença **CC0-1.0**. SHA-256 dos dois CSVs registrado em `configs/data.yaml` e conferido na ingestão.
- **Credenciais:** a conta de serviço `fraud-pipeline` foi criada pelo Douglas (a criação da chave foi bloqueada para mim pelo classificador de segurança, então ele rodou os comandos). Papéis: `bigquery.jobUser` e `bigquery.dataEditor`. Depois adicionei `bigquery.readSessionUser`, porque a Storage Read API exige esse papel para exportar.
- **Bronze:** `bronze_raw_transactions`, 1.852.394 linhas (load job, sem custo de consulta), particionada por mês e clusterizada por cartão. O índice exportado (`Unnamed: 0`) foi descartado.
- **Silver:** sem dados pessoais. O cartão virou `card_key` (SHA-256 com sal secreto no `.env`), sem nenhuma colisão. O prefixo `fraud_` em todo merchant é um artefato do gerador e foi removido. Perfis guardam só as coordenadas da casa arredondadas (~1 km), para a feature de distância.
- **Qualidade:**
  - 0 duplicatas, 0 nulos, 0 valores não positivos; 999 cartões, 693 merchants.
  - 44 empates (mesmo cartão no mesmo segundo).
  - **Atalho do gerador:** a maior fraude é de US$ 1.376,04, e 2.299 transações estão acima disso. Na Sparkov, valor muito alto nunca é fraude. Isso fica registrado como risco de "atalho" para o experimento C.
- **Gold:** 20 features point-in-time (janelas que terminam 1 s antes da transação). A feature de merchant usa só dias completos anteriores.
- **Splits:** warmup 2019-01, treino 2019-02 a 2019-12, tuning 2020-01 a 02, calibração 2020-03 a 04, política 2020-05 até 21/06, teste = arquivo de teste original.
- **Custo BigQuery até aqui:** cerca de 0,9 GiB faturado, dentro da faixa gratuita (log em `reports/metrics/bigquery_consumo.jsonl`).
- **Dúvida registrada:** o fuso horário não é informado. Usei o horário nominal do arquivo para `hour`/`weekday`.

### E1: validação pelo agente revisor: APROVADO
- **Recálculo independente em pandas:** 0 divergências em 722.566 valores (30 cartões, 55.582 transações). `merchant_distinct_cards_30d` também com 0 divergências em 2.000 linhas.
- **Splits:** sem sobreposição. O teste é exatamente o fraudTest.csv. Sem dados pessoais. Diferença máxima da distância para o haversine: 2,9e-5 km.
- **Correções aplicadas:**
  - Decimal → float na exportação;
  - `event_date` como data comum;
  - comentários SQL sem ";" (o separador de comandos quebrava);
  - experimento C ampliado (C1 sem valor, C2 sem valor e sem rajada, C3 com o Champion abaixo de US$ 800).
- **Atalhos do gerador documentados:**
  - teto de US$ 1.376;
  - rajadas: 976 de 999 cartões têm fraude, mediana de 10 fraudes em 1,9 dia;
  - horário: das 22h às 3h a taxa é 18 vezes maior.

### E2: modelagem (em andamento)
- **Ensaio sem Optuna** (avaliação no teste, mesmas linhas):
  - XGBoost B (com histórico): AP 0,956, ROC-AUC 0,9990, recall 98,6% com 1% de FPR;
  - XGBoost A (só a transação): AP 0,762;
  - **o histórico vale cerca de 19 pontos de AP**, e esse é o argumento comercial central.
- **Calibração:** a sigmoide ganhou da isotônica no Brier da janela policy (0,000653 contra 0,000656; empate técnico).
- **Problemas resolvidos:**
  - tipo `dbdate` do Parquet;
  - SQLAlchemy antigo para o MLflow 2.22;
  - emoji do MLflow quebrando o console do Windows (cp1252) → `PYTHONUTF8=1`;
  - o MLflow passou a rodar como servidor (`mlflow-artifacts:/`), para os artefatos serem portáveis para a VPS.
- **DNS:** zuperdata.com.br fica na Hostinger (ns dns-parking.com), e não tenho acesso a ela esta noite. Site e API sobem em endereços provisórios. **Pendente para o Douglas:** criar `A api-fraude → 2.29.40.32` e `CNAME fraude → cname.vercel-dns.com`.
- **Incidente:** o `create-next-app` travou numa pergunta interativa, e o `npm install` acabou rodando na raiz do projeto. Apaguei só os arquivos que esse comando criou (node_modules, package.json e package-lock na raiz). O frontend foi montado à mão.

### E2: treino final (Optuna com 30 trials, 1.795 s)
- **Champion: XGBoost B + Optuna.** AP no tuning 0,9825 (sem Optuna 0,9821). O ganho é pequeno, e isso é documentado com honestidade.
- **Teste:**
  - AP 0,9558; ROC-AUC 0,99894;
  - recall 97,9% com 0,5% de FPR e 98,7% com 1% de FPR;
  - ablação: AP 0,762 (A, só a transação) → 0,956 (B, com histórico).
- **Calibração sigmoide:** Brier no teste de 0,000807 → 0,000577.
- **Política** (t_auth 0,0101, t_review 0,1866):
  - aprova 99,29%, verifica 0,30%, investiga 0,40%;
  - 99,0% do valor fraudado sinalizado;
  - benefício líquido simulado de US$ 1,03 mi contra aprovar tudo;
  - custa 25% menos que a política de 1 corte (US$ 103,5 mil contra US$ 138,6 mil).
- **Estresse:** sem as features de valor, AP 0,564; sem valor e sem rajada, AP 0,211. Abaixo de US$ 800, o Champion tem AP 0,940. **O modelo depende muito dos atalhos do gerador**, e isso precisa ser dito na entrevista.
- **Cold start:** o segmento "<20 transações de histórico" tem 163 casos e todos são fraude. Artefato do gerador, a ser comunicado.
- **BUG encontrado pelos testes:**
  - o `xgb_champion.json` guarda todas as árvores (inclusive as depois do early stopping), mas a avaliação usou só até `best_iteration`;
  - o `Booster.predict` da API usava todas, e a AP saía 0,955786 contra 0,955799;
  - **correção:** `iteration_range=(0, best_iteration+1)` em toda inferência e em todas as contribuições;
  - o teste de round-trip agora passa com tolerância de 1e-9.
- **Outro erro, no próprio teste:** o teste de paridade dividia microssegundos como se fossem nanossegundos. Corrigido. Paridade offline × online: 0 divergências em 300 transações × 15 features.
- **pytest:** 35 passaram, 0 falharam (evidência em `reports/test_results/`).
