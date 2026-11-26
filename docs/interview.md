# Roteiro de entrevista: comece pelo negócio

Todos os números abaixo são reais e saem dos artefatos do projeto. Diga logo no começo: **"é um protótipo de portfólio com dados sintéticos públicos"**.

## 1. Abertura (≈ 45 s)

> "Em fraude, o banco não quer só acertar classificação. Ele quer proteger o dinheiro do cliente e da instituição sem barrar quem é legítimo, porque cada decisão custa algo: a fraude que passa, a verificação que irrita o cliente, o analista que revisa. Eu construí uma plataforma de portfólio que simula essa operação. Ela olha o histórico do cartão, calcula o risco, escolhe entre aprovar, pedir verificação ou reter, e registra tudo para auditoria e monitoramento. Os dados são sintéticos e públicos. Posso começar pelo resultado de negócio e depois abrir a parte técnica."

## 2. Bloco comercial (2 a 3 min, página Centro de operações)

- **Ponto de partida:** no teste, se o banco aprovasse tudo, perderia **US$ 1,13 milhão** em fraude.
- **Com a política:**
  - **99,18%** das compras passam direto, sem atrito;
  - 0,30% recebem uma verificação;
  - 0,52% vão para a fila de análise;
  - **99,3% do valor fraudado é sinalizado**;
  - 44 de 2.145 fraudes passam direto.
- **Sinalizado não é o mesmo que evitado.** A verificação barra 70% das fraudes e a análise 95%; isso são premissas. Por isso separo: valor sinalizado US$ 1,125 mi, potencialmente evitado US$ 1,063 mi, benefício líquido simulado US$ 1,03 mi.
- **Por que 3 níveis:** a política de 3 níveis custa 11% menos que a de um corte só (US$ 104 mil contra US$ 117 mil), porque o caso duvidoso recebe um atrito barato em vez de ir para o analista.
- **Os custos são cenários editáveis** (página Motor de decisão). Num banco, eles viriam do valor médio da fraude, do custo por análise e da taxa de abandono na verificação.

## 3. Demonstração ao vivo (2 a 3 min, página Simulador)

1. **Cenário habitual:** loja de sempre, valor típico. Resultado: **aprova**. Mostrar o histórico vindo do Redis.
2. **Cenário atípico:** loja online nova, valor alto, de madrugada, longe de casa. Resultado: **retém**. Mostrar:
   - os motivos SHAP, em log-odds e não em %;
   - a trilha com os tempos reais: lookup no Redis em cerca de 1 ms, inferência em cerca de 80 ms na VPS;
   - o ID de correlação e o evento no stream.
3. **Contrafactual:** mesmo cliente, mudar só o valor ou só a hora e mostrar o score reagindo. Ressaltar que isso **não prova causa**.
4. **Se der um resultado inesperado,** use como discussão de limite e não esconda.
5. **Motor de decisão:** mexer na eficácia da verificação e mostrar o corte de investigação mudando (sensibilidade).

**Plano B:** se a conexão falhar, use os prints com data em `docs/prints/`.

## 4. Transição

> "Se quiser, eu abro a metodologia inteira: origem da base, features, separação temporal, comparação de modelos, calibração, testes e infraestrutura. A interface é só a última camada."

## 5. Bloco técnico (3 a 5 min)

- **Por que acurácia engana:** o Dummy, que diz "nunca é fraude", teria 99,6% de acurácia. Eu uso a AP, cuja linha de base é a prevalência (0,39%).
- **Features point-in-time:** 14 features de comportamento no BigQuery, com janela que termina 1 segundo antes da transação. Um teste automatizado compara a mesma transação calculada pelo SQL e pela API: 0 divergências.
- **Ablação:** mesmas linhas, mesmos parâmetros. Só a transação dá AP 0,763; com histórico, 0,955. **O histórico do cliente é o que mais agrega.**
- **Protocolo:** treino, tuning, calibração, política e teste em janelas de tempo separadas. O teste só foi lido depois de tudo salvo. E declaro: **li o teste 3 vezes**. A 3ª foi por bugs que a revisão encontrou, não para melhorar número.
- **XGBoost:**
  - peso de classe em vez de SMOTE;
  - early stopping parou em 1.662 árvores;
  - Optuna com 25 trials **empatou** com o base, e eu digo isso.
- **Calibração:** o peso de classe infla o score, e a sigmoide corrige (Brier de 0,000588 para 0,000551). A calibração não muda a AUC.
- **Teste de estresse:** sem as features de valor, a AP cai para 0,54, porque a base tem atalhos (nenhuma fraude acima de US$ 1.376, fraudes em rajada). **0,958 é um teto otimista.**
- **Engenharia:**
  - BigQuery para o analítico; Redis para o online;
  - Streams com ACK depois de persistir, retomada de worker caído (XAUTOCLAIM) e fila de mensagens envenenadas;
  - MLflow com registry (v1 substituída, v2 champion);
  - challenger em modo sombra com cortes de mesma taxa de alerta;
  - replay com rótulo liberado só em D+30.
- **Testes:** 41 automatizados, 0 falhas, com a saída guardada. Teste de carga: 7,5 req/s numa VPS de 2 vCPU compartilhada, sem erros. **Não afirmo escala bancária.**

## 6. Fechamento (≈ 30 s)

> "O que eu quis mostrar é ligar modelagem, engenharia e decisão de negócio. Numa instituição real, o próximo passo seria validar custos e rótulos com dados internos, cuidar de segurança e governança, rodar em modo sombra e subir aos poucos. Não considero um modelo pronto para produção só porque ele teve uma boa métrica offline."

## 7. Perguntas difíceis, com respostas curtas

| Pergunta | Resposta |
|---|---|
| Por que não Kafka? | O volume é de demonstração. O Redis Streams dá o mesmo modelo de consumo (grupo, ACK, reentrega) com uma fração da memória. Kafka entra quando houver partições, retenção longa e vários consumidores. |
| Por que não Cloud Run? | A especificação pedia VPS e BigQuery, sem serviço pago novo. A API precisa de um modelo de cerca de 30 MB em memória e de um Redis sempre ligado, e a VPS já existia. |
| Como evitou vazamento? | Janelas que terminam em t−1 s. O rótulo nunca entra numa feature. Sem target encoding. Split temporal. Testes de paridade e de "evento futuro não altera feature passada". |
| Como validou o Redis? | O teste de paridade compara a feature calculada na API (dados vindos do Redis) com a do BigQuery. Os testes de integração rodam contra um Redis real. |
| Qual a limitação da base? | É sintética e tem atalhos: teto de valor, rajadas e cartões só de fraude. Não traz dispositivo, IP, Pix nem destinatário. |
| Qual o custo real? | BigQuery: cerca de 1,5 GiB faturado no projeto todo, dentro da faixa grátis, com cota de 20 GiB/dia e teto de R$ 50. A VPS já existia. |
| Como faria rollback? | O bundle é imutável e versionado e o registry guarda as versões. Basta trocar o alias champion, apontar o volume e subir com healthcheck. A v1 existe, mas foi substituída por bug, então a troca não foi demonstrada ao vivo. |
| O que deu errado? | A API resolveu o Redis do WhatsApp na rede compartilhada, porque o nome era genérico; corrigi com nome único. O bundle servia árvores além do early stopping, e o teste de round-trip pegou. A grade de cortes era grossa. Todos estão documentados. |
| Precision × Recall? | Precision: dos alertas, quantos eram fraude (70% no corte de investigação). Recall: das fraudes, quantas peguei (95% nesse corte). |
| AP × PR-AUC? | A AP soma em degraus; a PR-AUC usa trapézio. São cálculos diferentes e eu reporto os dois. |
| Threshold muda o modelo? | Não. Muda só a operação. A AUC é a mesma. |
| SHAP prova causa? | Não. Explica o modelo bruto em log-odds, não o mundo. |
| Data drift × concept drift? | Drift de dados é X mudar (PSI). Drift de conceito é a relação entre X e Y mudar, e só se vê com o rótulo maduro. |
