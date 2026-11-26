# Redesign executivo + Monitoramento do modelo (branch `redesign-executivo`, 26/11/2026)

Guia seguido: *Zuper Fraud Intelligence: Guia de Redesign* (PDF privado, fora do repositório).

## O que mudou (só apresentação, mais um artefato de monitoramento)

| Área | Mudança |
|---|---|
| Identidade | Paleta do guia (#090E17, proteção, inteligência, risco, atenção), fonte Geist + Geist Mono, Z da logo Zuper no menu e no favicon |
| Navegação | Grupos Business / Technology / Documentação; menu recolhível no celular; as 5 rotas originais mantidas + `/monitoramento` |
| Visão executiva | Benefício líquido em destaque (contagem animada), comparação de custo, 6 indicadores, cascata do risco ao benefício (tabela original em "Ver detalhamento"), fluxo proporcional dos 3 níveis, visão técnica recolhível, operação ao vivo mantida |
| Simulador | App de banco: valor grande, cartão, resultado colorido por ação; perfil comportamental com compra ÷ média; medidor do score com os cortes; SHAP em barras divergentes (log-odds); trilha de execução por etapa; estados de carregamento, vazio e erro ("nada é aprovado por padrão") |
| Motor, Lab, MLOps | Mesmo design system; nenhum cálculo alterado; Lab ganhou a linha C4 do teste de estresse (já existia no artefato) |
| **Monitoramento do modelo (novo)** | Modelo congelado reapresentado mês a mês e semana a semana sobre o período de teste: recall, precisão do alerta, AP, taxa de alerta, PSI por sinal, maturação D+30, alarmes declarados e runbook |

## Monitoramento: como os números são gerados

`pipelines/monitoramento.py` carrega o bundle congelado (`artifacts/model_bundle`), pontua as janelas policy e test do Parquet Gold **localmente** (sem BigQuery, sem retreino) e grava `reports/metrics/monitoramento.json`.

Conferência automática dentro do script: as contagens por ação, as fraudes e o benefício batem com `resultados.json` (`politica_teste`).

Achado real: em dez/20 o volume diário subiu cerca de 1,7×, mas a fraude não acompanhou (prevalência de 0,18% contra 0,45%). A precisão do alerta cai para 33%, enquanto o recall se mantém em 98%. Também aparece drift em "compras em 24 h" (PSI 0,59), que é sazonalidade. Jul/20 e nov/20 também dispararam o alarme de precisão (regra: queda de 10 p.p. sobre a referência de validação).

## Não modificado

Modelos, calibrador, features, datasets, cortes, premissas, métricas, endpoints, Redis, BigQuery, MLflow, VPS e configuração de produção.

## Verificação (`docs/redesign/verificacao.json`, 43/43)

- **Números-chave presentes** na visão executiva: 555.719 · 2.145 · US$ 38.562.903 · US$ 1.133.325 · US$ 1.029.297. As ações somam 555.719 (551.169 + 1.647 + 2.903).
- **Sem rolagem lateral** nas 6 páginas, em 1440, 1920 e 390 px.
- **Interações testadas:**
  - Simulador: cenário + what-if (sem gravar) e transação com evento (com a persistência assíncrona na trilha).
  - Motor de decisão: o slider recalcula o resultado na janela policy, "voltar à política congelada" restaura os valores, e o bloco do teste não tem nenhum controle (somente leitura).
  - Monitoramento: alternância mensal/semanal.
  - Menu do celular: abre, navega e fecha.
- **Console do navegador:** 0 erros.
- **Build e tipos:** `next build` e `tsc --noEmit` sem erros. O projeto não tem ESLint configurado.
- **Testes automatizados:** 41/41 passaram (`reports/metrics/teste_pytest.json`).

Efeito colateral dos testes: 3 transações de teste (cenário Habitual) foram registradas na API da VPS, como qualquer uso do simulador. Antes da entrevista, rodar `docker compose run --rm loader` (já está no STATUS).

## Evidências visuais

- `docs/redesign/antes/`: produção atual, 5 páginas × 1440 / 1920 / 390.
- `docs/redesign/depois/`: as 6 páginas nas mesmas larguras, mais simulador (what-if e transação), detalhamento, monitoramento semanal e menu do celular.
- Regerar: `cd tools && node redesign_prints.mjs [antes|depois|telas]`.

## Rollback do frontend

- **Antes do merge:** a produção continua na `main`; basta não fazer o merge.
- **Depois do merge:** `git revert <commit>` e um novo deploy, ou "Promote" do deploy anterior no painel da Vercel. Nenhum serviço de backend precisa voltar.
