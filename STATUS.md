# STATUS: Zuper Fraud Intelligence

A especificação completa está em `docs/ESPECIFICACAO.md`.

## Gate 0: inspeção do ambiente (26/11/2026), sem nenhuma alteração

| Recurso | Situação | Observação |
|---|---|---|
| Dataset Sparkov (Kaggle) | OK, acessível | `fraudTrain.csv` (351 MB) e `fraudTest.csv` (150 MB), lidos pela API do Kaggle. Ainda não baixados |
| Computador de desenvolvimento | OK | 12 núcleos, 31 GB de RAM, Python 3.11, Node 22, Docker 29.8 |
| VPS Hetzner `server-whatsapp` | Acesso SSH OK | 2 vCPU, 3,7 GB de RAM (2,4 GB livres), 27 GB de disco livre. **Compartilhada** com Evolution/WhatsApp (2 projetos), `midia` e Caddy (80/443) |
| Google Cloud | Pendente: falta definir o projeto | gcloud 587 instalado. Conta ativa: `douglas_caldeira@thenorthscale.com`, que **não** deve ser usada. A conta pessoal tem 6 projetos e 2 contas de faturamento |
| BigQuery | Pendente | Dataset `fraud_intelligence` ainda não criado. A CLI `bq` local está com erro de Python |
| Redis, MLflow | Ainda não instalados | Ficarão em contêineres próprios na VPS, sem portas públicas |
| GitHub pessoal | OK | Token `douglas-data99` funcionando (no `.env`, fora do git) |
| Domínio / HTTPS | Pendente: falta definir o endereço | O Caddy da VPS já serve HTTPS para outros subdomínios |

## Gate 0.1: Google Cloud e trava de custo (26/11/2026)

- **Conta:** `douglasexcel4job@gmail.com` (Zuper Data), agora a conta padrão do gcloud. A da North Scale não é usada.
- **Projeto exclusivo:** `zuper-fraud-intelligence`, ligado à "Minha conta de faturamento" (BRL). A outra conta de faturamento recusou o projeto porque já tem 5 projetos ligados.
- **Orçamento:** `Zuper Fraud Intelligence - teto R$50`, com alertas em 50%, 90% e 100% do gasto real e em 100% do gasto previsto. Ele **só avisa, não bloqueia**.
- **O que de fato trava o gasto:** cota de consulta do BigQuery de **20 GiB por dia**, no projeto e por usuário. São no máximo cerca de 620 GiB por mês, abaixo da faixa gratuita de 1 TiB de consulta por mês. Com isso, o gasto previsto em consulta fica perto de R$ 0, e o armazenamento (poucos GB) fica dentro ou perto da faixa gratuita de 10 GB.
- **Regra do Douglas:** o modelo **não** treina nem é testado no BigQuery (nada de BigQuery ML). O BigQuery guarda os dados e monta as variáveis; treino e avaliação rodam fora. Toda consulta do código terá `maximum_bytes_billed`.

## Riscos encontrados

- **RAM da VPS:** 2,4 GB livres para Redis, MLflow, API e worker, junto com o WhatsApp em produção. Proposta: **treinar no computador** e levar só o modelo para a VPS, com um limite de memória em cada contêiner.
- **Caddy compartilhado:** para criar um subdomínio novo é preciso mexer no Caddyfile da Evolution, o que pede autorização.

## Próximo gate (P0)

Baixar o Sparkov, fazer a EDA, gerar as features point-in-time e treinar o baseline e o XGBoost, tudo localmente.
