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

### INCIDENTE na VPS (26/11/2026, ~08:55): a API resolveu o Redis do WhatsApp
- **Causa:** a API está em duas redes, a interna do projeto e a `evolution_default` do Caddy, que é a mesma do WhatsApp. Na rede do Caddy já existe um host chamado `redis` (Redis da Evolution). Com `REDIS_URL=redis://redis:6379/0`, a API resolveu o Redis do WhatsApp em vez do nosso.
- **O que pode ter sido escrito lá:**
  - só a chave `fraud:replay:comando`, gravada 2 vezes pelo `POST /admin/replay`, com o valor `{"acao": "iniciar", "eps": 15.0, "deriva_valor": 1.0}`, sem TTL;
  - leituras de `/architecture/status` e `/health` (não escrevem);
  - nenhuma transação, perfil ou contador passou pela API pública nesse intervalo;
  - o loader roda num contêiner só na rede interna e escreveu no nosso Redis.
- **Correção:** o nosso Redis passou a ter o nome único `zfi-redis`, e todo `REDIS_URL` aponta para ele. Confirmado: o comando agora cai no nosso Redis.
- **Pendente para o Douglas:** o classificador de segurança me impediu (corretamente) de acessar o Redis do WhatsApp para conferir e limpar. Se quiser remover a chave órfã, que é pequena e não interfere na Evolution, porque a Evolution não usa o prefixo `fraud:`:
  `docker exec evolution-redis-1 redis-cli DEL fraud:replay:comando` (e o mesmo em `evolution-prospect-prospect-redis-1`, se existir lá).
- **Lição:** em rede compartilhada, nunca usar nome de serviço genérico. Registrada também em `docs/architecture.md`.

### E2: revisão (2 rodadas) → APROVADO
- **1ª rodada (REPROVADO):**
  - o bundle servia árvores além do `best_iteration`;
  - a grade de cortes tinha passos de 442 linhas, o que deixava a sensibilidade inútil;
  - o early stopping era limitado pelo teto de árvores;
  - a ablação usava o modelo errado;
  - o segmento "frio" é artefato (cartões só de fraude).
- **Correções e novo treino** (3ª leitura do teste, declarada em `leituras_do_teste.json`). Números finais:
  - AP 0,9583; ROC-AUC 0,9990; recall 98,1% com 0,5% de FPR;
  - 1.662 árvores, com o early stopping parando de fato;
  - Brier no teste: 0,000588 → 0,000551 (sigmoide);
  - cortes 0,0082 / 0,0388;
  - aprova 99,18%, verifica 0,30%, investiga 0,52%;
  - 99,3% do valor fraudado sinalizado;
  - 3 níveis custam 11% menos que 1 corte;
  - C1 0,538, C2 0,236, C3 0,945, C4 0,951;
  - Optuna empatou com o modelo base.
- **2ª rodada: APROVADO.** Bundle e política recalculados à mão bateram com diferença 0.

### E3 a E5: API, interface, deploy → APROVADO (após 2 rodadas)
- **1ª rodada (REPROVADO).** Os problemas e as correções:
  - **Memória do Redis** acabaria em cerca de 6 h de replay. Agora: stream limitado com XDEL, TTL curto e rótulos maduros como contadores.
  - **Simulador** mostrava o histórico de outro cartão (closure velha). Corrigido com uma ref do cartão atual.
  - **Worker** podia perder update. Agora o marcador `applied` é gravado no mesmo MULTI do perfil.
  - **BigQuery** recebia duplicatas, porque a persistência é "pelo menos uma vez". Criadas as views `v_predictions`, `v_decisions` e `v_auditoria_diaria`.
  - **Mensagem envenenada** entrava em loop. Agora vai para a DLQ.
  - **Nome genérico `api`** na rede compartilhada. Renomeado para `zfi-api`.
  - **Shadow comparado errado** (RF sem calibração cortado pelos cortes do XGB). Agora o RF tem cortes próprios, com a mesma taxa de alerta.
  - **PSI com janela curta** acusava drift em `hour`. Janela de 20 mil eventos, sem `hour`.
  - **Menores:** 503 em todo endpoint, `extra=forbid`, N/D, acentos, Lab sem números fixos no código.
- **Falha de segurança achada por mim no teste de carga:** o rate limit confiava no 1º IP do X-Forwarded-For, que o cliente pode forjar. Corrigido, com teste.
- **2ª rodada:** sobrou um bloqueio (o Redis encheria em cerca de 25 h). Corrigido com `volatile-ttl` e TTL de 6 h no replay. **APROVADO.**
- **Desempenho:** o score passou a sair da soma das contribuições SHAP, numa passada só (diferença de 6e-8). Carga na VPS, com a API limitada a 0,8 vCPU: 300 requisições, 4 simultâneas, 7,5 req/s, p50 512 ms ponta a ponta, 0% de erro.

### E8: publicação (concluída)
- **GitHub (douglas-data99, públicos):**
  - `zuper-fraud-intelligence`
  - `deteccao-fraude-abertura-de-contas`
  - `portfolio` (sem a pasta `tcc/`)
  - Commits com o e-mail noreply. Nenhum segredo, conferido pelo teste de segurança.
- **Aplicação:** https://zuper-fraud-intelligence.vercel.app (Next.js 15.5.29; a Vercel recusou a 15.3.3 por vulnerabilidade).
- **API:** https://zfi-api.2-29-40-32.sslip.io. Endereço provisório: falta o DNS de `api-fraude.zuperdata.com.br`.
- **Portfólio:** https://zuperdata.com.br/douglas-portifolio, com os 2 projetos de fraude cadastrados.
  - Antes do deploy, conferi que a pasta local `zuperdata_site` era idêntica ao site no ar (hash dos arquivos e redirect do /admin). Assim, o deploy só acrescentou o portfólio.
  - **A pasta `zuperdata_site/douglas-portifolio/` não foi commitada no repositório SITES:** fica para o Douglas.
