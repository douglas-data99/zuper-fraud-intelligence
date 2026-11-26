# Zuper Fraud Intelligence: progresso completo (atualizado em 26/11/2026)

Este arquivo junta num só lugar tudo o que foi feito até agora. Ele serve ao Douglas para retomar o projeto e ao ChatGPT para revisá-lo. Os números vêm dos artefatos do pipeline (`reports/metrics/`); quando um número é premissa, o texto avisa.

> Projeto de portfólio com **dados sintéticos públicos** (Sparkov, Kaggle, CC0), sem ligação com nenhum banco. Os valores estão em USD, a moeda da base. Os custos da política são premissas editáveis.

---

## 1. Links atuais

| O quê | Endereço |
|---|---|
| **Site (6 páginas)** | https://fraude-analytics.zuperdata.com.br |
| **API (FastAPI, VPS)** | https://api-fraude.zuperdata.com.br (documentação em `/docs`) |
| Endereço antigo do site (ainda funciona) | https://zuper-fraud-intelligence.vercel.app |
| Endereço antigo da API (ainda funciona) | https://zfi-api.2-29-40-32.sslip.io |
| Código do projeto | https://github.com/douglas-data99/zuper-fraud-intelligence |
| Estudo de fraude em abertura de contas (BAF) | https://github.com/douglas-data99/deteccao-fraude-abertura-de-contas |
| Código do portfólio | https://github.com/douglas-data99/portfolio |
| Portfólio no ar | https://zuperdata.com.br/douglas-portifolio |
| Vídeo explicativo (4 min 15 s, voz clonada) | https://github.com/douglas-data99/zuper-fraud-intelligence/releases/tag/v1.0 · cópia em `Vídeos/Zuper/Zuper Fraud Intelligence/` |
| MLflow (privado) | só por túnel SSH: `ssh -i $HOME\.ssh\zuper_vps -N -L 5005:127.0.0.1:5005 root@2.29.40.32` e depois http://localhost:5005 |

As 6 páginas do site:

| Grupo | Páginas |
|---|---|
| Business | Visão executiva, Simulador bancário, Motor de decisão |
| Technology | Data Science Lab, Monitoramento do modelo, Engenharia e MLOps |
| Documentação | link para o GitHub |

---

## 2. Linha do tempo

### 2.1 Antes do projeto (preparação)
- **Portfólio pessoal:** em `/douglas-portifolio`, com o estudo de churn do TCC e o cadastro em `assets/js/dados.js`.
- **Estudo BAF de fraude em abertura de contas:** XGBoost com AP 0,181 e recall de 52,6% a 5% de falso positivo.
- **Comparação com o projeto de referência** (PaySim, outro autor): lido sem login. Não foi copiado e não é citado publicamente.
- **Especificação:** feita pelo ChatGPT e salva em `docs/ESPECIFICACAO.md`, que fica fora do git.

### 2.2 Custos e contas (antes de construir)
- **Projeto GCP próprio** (`zuper-fraud-intelligence`, conta Google da Zuper Data):
  - orçamento de R$ 50 com alertas;
  - cota de consulta do BigQuery de 20 GiB por dia.
- **BestByBrasil:** os agendadores foram pausados.
  - Por engano, 9 Cloud Functions foram apagadas. Um agente as recriou a partir dos logs de auditoria e do código em `Infinity/docs/etl`.
  - Registro: `bbb-agente/base/docs/RECRIACAO-FUNCOES-2026-11-26.md`.
- **Zupfy:** encerrado pelo próprio Douglas.

### 2.3 Construção noturna (etapas E1 a E8, cada uma validada por agente revisor)

| Etapa | O que entrou | Revisão |
|---|---|---|
| **E1** | Ingestão Bronze com SHA-256 dos arquivos, Silver pseudonimizada, Gold com features point-in-time | aprovada. Recálculo independente em pandas: 0 divergências em 722.566 valores |
| **E2** | Treino: Dummy, regressão logística A/B, Random Forest B, XGBoost A/B e XGBoost B + Optuna; calibração; política de 3 níveis; SHAP | reprovada e depois aprovada. Pegou o bundle servindo árvores além do `best_iteration` |
| **E3 a E5** | API FastAPI, Redis como feature store, Redis Streams + worker, gravação no BigQuery, replay com relógio virtual, interface Next.js | reprovada duas vezes e depois aprovada. Ver os bugs logo abaixo |
| **E6 a E8** | Deploy na VPS e na Vercel, teste de carga, prints do MLflow, documentação, vídeo, portfólio no ar | concluída |

Bugs reais que as revisões pegaram e que foram corrigidos:
- **Modelo servido maior que o medido:** tinha árvores a mais. Correção: `iteration_range` e corte do booster.
- **Redis lotando em horas:** stream sem limite e chaves sem TTL. Correção: XDEL depois do ACK, `maxlen`, TTLs, rótulos agregados e política `volatile-ttl`.
- **Simulador:** uma closure velha e um cenário sobrescrito por valores padrão. Correção: refs `cardAtual` e `pendente`.
- **Gravação:** perda de atualização no perfil (transação WATCH/MULTI com marcador `fraud:applied`) e duplicatas no BigQuery (views sem duplicata).
- **Fila de erros:** mensagem com defeito em loop. Correção: fila de mensagens com defeito (DLQ); erro transitório não vai para a DLQ.
- **Comparação desigual com o challenger:** ele agora usa cortes próprios, com a mesma taxa de alerta.
- **Falso drift no PSI:** a feature `hour` saiu e a janela passou para 20 mil eventos.
- **Limite de acessos burlável** pelo cabeçalho X-Forwarded-For: agora vale o último IP. Achado na minha própria revisão.
- **Contrato da API:** respostas 503 explícitas e `extra="forbid"` na entrada.

### 2.4 Publicação (manhã de 26/11)
- **Repositórios públicos no GitHub** (`douglas-data99`) e o vídeo publicado como release v1.0.
- **Site na Vercel** e **API na VPS Hetzner**, que é compartilhada com o WhatsApp da Zuper.
- **Portfólio no ar** com os dois projetos de fraude.
- **Relatório para o ChatGPT:** `docs/RELATORIO-PARA-REVISAO.md`, com cópia em `Downloads`.

### 2.5 Redesign executivo (tarde de 26/11, a partir do guia em PDF)
- **Identidade visual:**
  - paleta do guia (fundo #090E17; verde para proteção, azul para inteligência, vermelho para risco e âmbar para atenção);
  - fontes Geist e Geist Mono;
  - o **Z da logo Zuper** no menu e no ícone da aba.
- **Navegação** dividida em Business, Technology e Documentação, com menu recolhível no celular.
- **Visão executiva:**
  - benefício líquido em destaque;
  - comparação de custos;
  - 6 indicadores;
  - gráfico em cascata do risco ao benefício (a tabela original fica em "Ver detalhamento");
  - fluxo proporcional dos 3 níveis;
  - visão técnica recolhível.
- **Simulador** com cara de app bancário:
  - perfil do cliente com a razão "compra ÷ média";
  - SHAP em barras;
  - trilha de execução por etapa;
  - estados claros de carregando, vazio e erro.
- **Verificação:** 43 de 43 checagens no navegador e 41 de 41 testes automatizados. Prints de antes e depois em 1440, 1920 e 390 px.
- **Fluxo de trabalho:** branch separada `redesign-executivo`, juntada na `main` e publicada com a autorização do Douglas.

### 2.6 Módulo "Monitoramento do modelo" (página nova)
- **Pedido do Douglas:** mostrar se o modelo continua acertando depois de implantado. Ele escolheu a opção A: só dados reais, nada simulado.
- **Como funciona:** modelo, calibrador e cortes foram congelados **antes** do período de teste. Por isso, os meses de teste (21/06 a 31/12/2020) funcionam como "produção". O script `pipelines/monitoramento.py` só faz inferência com o bundle congelado:
  - roda no computador local, sem BigQuery e sem retreino;
  - mede cada mês e cada semana;
  - confere sozinho que a soma dos meses bate com o resultado oficial do teste.

### 2.7 Ajustes do simulador (tarde de 26/11)
- **Medidor:** passou a ser **linear, de 0 a 100%**, como o manual pede. Antes era logarítmico.
- **Score:** mostrado em porcentagem, com uma frase que diz em qual limite ele caiu.
- **Rótulo:** "Score bruto (antes da calibração)".
- **Modelo reserva:** passou a se chamar **challenger** ("em observação, não decide").
- **Correção:** quando a API falha, o perfil mostra "indisponível" em vez de ficar carregando para sempre.

### 2.8 Domínios próprios (tarde de 26/11)
- `fraude-analytics.zuperdata.com.br` aponta para a Vercel.
- `api-fraude.zuperdata.com.br` aponta para a VPS, com HTTPS automático pelo Caddy.

---

## 3. Resultados principais

### 3.1 Período de teste (555.719 transações de 21/06 a 31/12/2020; política congelada antes)

| Indicador | Valor |
|---|---|
| Fraudes confirmadas | 2.145 (US$ 1.133.325 em valor fraudado) |
| Volume transacionado | US$ 38.562.903 |
| Aprovadas direto | **99,18%** (551.169) |
| Verificação adicional | 0,30% (1.647) |
| Retidas para investigação | 0,52% (2.903) |
| Taxa de alerta | 0,82% (4.550) |
| Valor fraudulento sinalizado | **99,3%** |
| Fraudes que passaram direto | 44 de 2.145 |
| Benefício líquido simulado contra aprovar tudo | **US$ 1.029.297** (90,8% menos custo total) |
| Custo total com a política | US$ 104.028, contra US$ 1.133.325 se aprovasse tudo |
| Valor potencialmente evitado | US$ 1.063.240 (exposição − perda residual) |
| 3 níveis contra 1 corte | 11% mais barato **no teste**; na janela policy, onde os cortes foram escolhidos, a diferença é de 3,5% |

### 3.2 Modelos (teste)

| Modelo | AP | ROC-AUC | Recall a 0,5% FPR |
|---|---:|---:|---:|
| Dummy | 0,004 | 0,500 | 0,5% |
| Regressão logística B | 0,281 | 0,981 | 66,7% |
| Random Forest B (challenger) | 0,888 | 0,997 | 94,3% |
| XGBoost A (só transação) | 0,763 | 0,996 | 84,9% |
| XGBoost B (+ histórico) | 0,955 | 0,999 | 97,9% |
| **XGBoost B + Optuna (Champion)** | **0,958** | **0,999** | **98,1%** |

- **Ablação:** o histórico do cliente leva a AP de 0,763 para 0,955, nas mesmas linhas de teste.
- **Calibração sigmoide:** o Brier no teste cai de 0,000588 para 0,000551.
- **Optuna:** empatou com o modelo base (+0,003 de AP). Está registrado como empate.
- **Teste de estresse:**
  - C1, sem as features de valor: 0,538;
  - C2, sem valor e sem velocidade: 0,236;
  - C3, só compras abaixo de US$ 800: 0,945;
  - C4, sem o tamanho do histórico: 0,951.
  - Conclusão: a base sintética tem atalhos, e **0,958 é um teto otimista**.

### 3.3 Monitoramento mês a mês (modelo congelado)

| Mês | Transações | Fraudes | Prevalência | Taxa de alerta | Recall | Precisão do alerta | AP |
|---|---:|---:|---:|---:|---:|---:|---:|
| jun/20 (10 dias) | 30.058 | 133 | 0,44% | 0,91% | 98,5% | 48,2% | 0,974 |
| jul/20 | 85.848 | 321 | 0,37% | 0,80% | 96,9% | 45,5% | 0,945 |
| ago/20 | 88.759 | 415 | 0,47% | 0,91% | 98,3% | 50,4% | 0,967 |
| set/20 | 69.533 | 340 | 0,49% | 0,95% | 97,9% | 50,2% | 0,963 |
| out/20 | 69.348 | 384 | 0,55% | 1,02% | 98,2% | 53,5% | 0,965 |
| nov/20 | 72.635 | 294 | 0,40% | 0,90% | 98,0% | 44,0% | 0,965 |
| dez/20 (rótulo imaturo) | 139.538 | 258 | 0,18% | 0,55% | 98,1% | 33,1% | 0,930 |

A referência é a janela de validação (policy): recall de 99,1%, precisão de 57,5% e AP de 0,979.

**Leitura:**
- **O modelo continua pegando a fraude:** o recall ficou entre 96,9% e 98,5% em todos os meses.
- **O que oscila é a precisão dos alertas.** Os meses jul/20, nov/20 e dez/20 dispararam o alarme de precisão, cuja regra é uma queda de mais de 10 pontos percentuais em relação à referência.
- **Dezembro é efeito de prevalência e sazonalidade, não defeito do modelo.**
  - O volume diário subiu cerca de 1,7× com o fim de ano, mas a fraude não acompanhou: a prevalência caiu para 0,18%, contra cerca de 0,45% antes.
  - Com menos fraude no meio de mais compras, uma fatia maior dos alertas é cliente bom, e a precisão cai para 33%, mesmo com a taxa de alerta **menor**.
  - O drift aparece no ritmo de compra: "compras em 24 h" teve PSI de 0,59 e "tempo desde a última compra", 0,19. O score do modelo ficou estável (PSI de no máximo 0,008).
- **Ação recomendada** (o runbook da página):
  1. esperar a safra madurar, porque o rótulo atrasa até 30 dias;
  2. revisar os cortes para a sazonalidade;
  3. comparar com o challenger;
  4. retreinar só com safra madura e com aprovação.

### 3.4 Operação
- **Teste de carga:** 7,5 requisições por segundo, mediana (p50) de 512 ms de ponta a ponta (Brasil → Helsinque), 0% de erro.
- **Custo do BigQuery:** cerca de 1,5 GiB faturado no projeto inteiro, dentro da faixa grátis.
- **Testes automatizados:** 41 de 41 passaram (`reports/metrics/teste_pytest.json`).

---

## 4. Arquitetura e onde está cada coisa

```
Kaggle (Sparkov) → BigQuery Bronze → Silver (pseudonimizada) → Gold (features point-in-time)
Gold → treino em Python (fora do BigQuery) → MLflow (registry) → bundle congelado
Gold → snapshot → Redis (feature store online)
Next.js (Vercel) → FastAPI (VPS) → Redis Streams → worker → BigQuery (predictions, decisions)
Replay (relógio virtual) → mesma API → monitoramento ao vivo (PSI, safra madura D+30)
```

| Pasta ou arquivo | Conteúdo |
|---|---|
| `configs/` | `data.yaml` (projeto GCP, splits, limite de bytes), `model.yaml`, `policy.yaml` (premissas de custo) |
| `sql/silver`, `sql/gold` | transformações no BigQuery, incluindo as views sem duplicata |
| `pipelines/` | `ingest.py`, `build_features.py`, `snapshot.py`, `train.py`, `challenger_cortes.py`, **`monitoramento.py`**, `rodar_testes.py`, `carga.py` |
| `backend/app/` | API (`main.py`), features, decisão, scoring, store, worker, replay, loader |
| `frontend/` | Next.js 15.5.29. Páginas em `app/`, componentes em `components/` (inclui `LogoZ.tsx`), dados em `public/data/` |
| `artifacts/model_bundle/` | modelo, calibrador, challenger, política, referência de drift. Fora do git |
| `reports/metrics/` | todos os números: `resultados.json`, **`monitoramento.json`**, `carga.json`, `teste_pytest.json` etc. |
| `tests/` | 41 testes de unidade e integração |
| `tools/` | `prints.mjs` (MLflow e site), **`redesign_prints.mjs`** (antes e depois + interações), `portfolio_print.mjs` |
| `docs/redesign/` | prints de antes e depois, `verificacao.json` (43/43) e `RELATORIO.md` |
| `docs/` | `DIARIO.md`, `architecture.md`, `methodology.md`, `limitations.md`, `interview.md`, `RELATORIO-PARA-REVISAO.md`, `Zuper_Fraud_100_Respostas.md` |
| `video/` | roteiro, narração, render e montagem do vídeo |
| `docker-compose.yml` | serviços `zfi-redis`, `zfi-api`, `worker`, `replay`, `mlflow` e `loader`, com limites de memória |
| VPS `/opt/zuper-fraud` | a stack em produção |

---

## 5. Decisões do Douglas e regras do projeto

- **Objetivo:** disputar uma vaga de cientista de dados especialista em fraude, com foco em negócio, engenharia e produto, e não só em métrica.
- **Projeto de referência (PaySim):** não copiar nem citar publicamente.
- **Google Cloud:** usar a conta Google da Zuper Data, nunca a da North Scale.
- **BigQuery:**
  - teto de **R$ 50**;
  - **nunca treinar nem testar modelo no BigQuery**: ele monta os dados e os testes rodam fora dele.
- **BestByBrasil:** custo zero, com os agendadores **pausados e as funções preservadas**. Nunca apagar.
- **Publicação autorizada:** repositórios públicos, site na Vercel, API na VPS e portfólio com os dois projetos de fraude.
- **Monitoramento:** opção A, só com dados reais.
- **Medidor do simulador:** linear, de 0 a 100%. O modelo reserva se chama **challenger**.
- **Domínios:** `fraude-analytics` para o site e `api-fraude` para a API.
- **Regras de trabalho:**
  - reescrever pedidos grandes como prompt e validar antes de construir;
  - confirmar antes de qualquer ação destrutiva;
  - não mexer em serviços compartilhados da VPS (WhatsApp, Caddy) além do mínimo combinado;
  - publicar só depois do ok;
  - nunca expor tokens, chaves nem dados pessoais;
  - não publicar a pasta `tcc/`, que tem o endereço residencial;
  - sites de clientes não vão para o GitHub pessoal.

---

## 6. Incidentes e lições

| Incidente | O que aconteceu | Lição |
|---|---|---|
| **Redis do WhatsApp** | A API usava o nome genérico `redis`, numa rede Docker compartilhada com o WhatsApp. Ela gravou uma chave pequena (`fraud:replay:comando`) no Redis do WhatsApp | Serviços com nomes únicos (`zfi-redis`, `zfi-api`). O WhatsApp nunca parou. A chave órfã continua lá (ver pendências) |
| **Funções do BestByBrasil apagadas** | Depois de uma resposta ambígua, 9 Cloud Functions foram apagadas, e o Douglas tinha pedido só para pausar | Recriadas a partir dos logs e do código. Ação destrutiva só com confirmação explícita |
| **Erro 404 preso no cache** | Páginas novas (o portfólio e depois `/monitoramento`) mostraram 404 logo após o deploy, porque o endereço tinha sido consultado antes de existir | Resolve sozinho em poucos segundos ou minutos. Não consultar a rota antes de publicar |
| **CORS na prévia da Vercel** | A prévia não acessa a API, que só aceita o endereço oficial e o localhost | Esperado. Testar no localhost ou depois de publicar |
| **Memória da VPS** | O loader foi encerrado por falta de memória dentro da API, e o MLflow estava no limite | Loader virou um serviço separado; o MLflow roda com 1 worker |
| **Teste lido 3 vezes** | A 3ª leitura foi motivada por bugs apontados pela revisão, não pelo resultado | Declarado em `reports/metrics/leituras_do_teste.json` |

---

## 7. Configuração feita hoje (VPS, DNS, Vercel)

- **DNS na Hostinger** (feito pelo Douglas):
  - `CNAME fraude-analytics → 3fdd09b4a9c2135a.vercel-dns-016.com`;
  - `A api-fraude → 2.29.40.32`.
- **Caddy na VPS:**
  - backup do `/opt/evolution/Caddyfile` antes de mexer;
  - novo bloco `api-fraude.zuperdata.com.br → zfi-api:8000`;
  - validado e **recarregado sem reiniciar**. O HTTPS saiu automático.
- **CORS da API:**
  - `https://fraude-analytics.zuperdata.com.br` foi incluído em `CORS_ORIGINS` no `/opt/zuper-fraud/.env.vps`, com backup antes;
  - recriado **só** o contêiner `zfi-api`.
- **Vercel:**
  - os domínios `fraude-analytics.zuperdata.com.br` (em uso) e `fraude.zuperdata.com.br` (sem uso) foram cadastrados no projeto;
  - o deploy em produção precisa de `--build-env NEXT_PUBLIC_API_URL=https://api-fraude.zuperdata.com.br`, porque **a variável não está cadastrada na Vercel**.

---

## 8. Pendências em aberto

1. **Recarregar os cenários antes da entrevista.** Os testes gravaram transações (cenário "Habitual") e o replay avança o histórico dos cartões. Na VPS: `cd /opt/zuper-fraud && docker compose run --rm loader`.
2. **Link do portfólio** ainda aponta para o endereço antigo, que funciona. Trocar exige republicar o `zuperdata_site` inteiro, e a pasta tem alterações sem commit de outros trabalhos. Precisa do ok do Douglas.
3. **Domínio `fraude.zuperdata.com.br`** está cadastrado no projeto Vercel sem uso. Remover pelo painel (projeto → Domains).
4. **Checagem de saúde do replay** estoura 5 s às vezes, e o contêiner aparece "unhealthy" mesmo funcionando. É a VPS pequena e compartilhada. Avaliar se o timeout deve subir.
5. **Chave órfã no Redis do WhatsApp** (opcional): `docker exec evolution-redis-1 redis-cli DEL fraud:replay:comando`. O sistema de segurança não deixou o agente fazer isso.
6. **Portfólio com `noindex`:** decidir se deve aparecer no Google.
7. **Commits no repositório SITES:** a pasta `zuperdata_site/douglas-portifolio/` e as funções do BestByBrasil em `Infinity/docs/etl`.
8. **Divergências da auditoria** (`docs/Zuper_Fraud_100_Respostas.md`, 18 itens, D1 a D18). A D1 ("5 páginas") já foi resolvida: hoje são 6 páginas no ar. As que mais importam para a entrevista:
   - **D3:** a diferença entre a soma do SHAP e o score é de 8,9e-7, não "6e-8";
   - **D4:** a sensibilidade só varia três eixos;
   - **D8:** o Registry v2 tem 1.762 árvores, contra 1.662 no bundle servido;
   - **D10:** 3 níveis custam 11% menos no teste, mas só 3,5% menos na janela policy;
   - **D12:** 16 cartões só existem no teste e o replay os pula;
   - **D13:** "Outro estado (~1.000 km)" fica fora da faixa vista no treino, que vai até 152 km;
   - **D16:** o `train.py` move o alias champion sozinho.
9. **Relatório para o ChatGPT:** atualizar o `docs/RELATORIO-PARA-REVISAO.md` com o redesign, o monitoramento e as correções da auditoria, ou mandar este arquivo junto.
10. **Optuna e rollback:** o Optuna empatou com o modelo base, e o rollback ao vivo ainda não foi demonstrado (só v1 → v2 no registry).

---

## 9. Como retomar

```bash
# ambiente
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt

# dados e modelo (BigQuery só monta os dados; treino é local)
make ingest features snapshot
make mlflow &          # tracking local
make train             # treino, calibração, política, avaliação, registro
make monitor           # monitoramento mês a mês com o bundle congelado

# testes (Redis de teste na porta 6390)
docker run -d -p 127.0.0.1:6390:6379 redis:7.4-alpine
cd pipelines && python rodar_testes.py      # grava reports/metrics/teste_pytest.json

# interface
cd frontend
node scripts/sync-data.mjs                  # copia reports/ para public/data
NEXT_PUBLIC_API_URL=https://api-fraude.zuperdata.com.br npx next build
npx next start -p 3000                      # localhost:3000 também é aceito pela API

# evidências visuais
cd tools && node redesign_prints.mjs telas  # ou: antes | depois (depois faz uma transação real)

# publicar o site (só com ok do Douglas)
cd frontend && vercel deploy --prod --yes --build-env NEXT_PUBLIC_API_URL=https://api-fraude.zuperdata.com.br

# VPS
ssh -i ~/.ssh/zuper_vps root@2.29.40.32
cd /opt/zuper-fraud && docker compose ps
```

Antes de mexer, leia `STATUS.md`, `docs/DIARIO.md` e este arquivo.
