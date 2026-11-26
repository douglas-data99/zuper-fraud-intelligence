# STATUS: Zuper Fraud Intelligence (26/11/2026, manhã)

## Links

| | |
|---|---|
| Aplicação | https://zuper-fraud-intelligence.vercel.app |
| API | https://zfi-api.2-29-40-32.sslip.io (provisório; documentação em `/docs`) |
| Código | https://github.com/douglas-data99/zuper-fraud-intelligence |
| Estudo BAF | https://github.com/douglas-data99/deteccao-fraude-abertura-de-contas |
| Portfólio | https://zuperdata.com.br/douglas-portifolio · código em https://github.com/douglas-data99/portfolio |
| Vídeo explicativo | https://github.com/douglas-data99/zuper-fraud-intelligence/releases/tag/v1.0 · cópia em `Vídeos/Zuper/Zuper Fraud Intelligence/` |

## O que está pronto (implementado e testado)

| Item | Estado | Evidência |
|---|---|---|
| Ingestão Bronze com checksum | ✅ | `reports/metrics/ingestao.json` |
| Silver sem dados pessoais e com qualidade checada | ✅ | `qualidade_silver.json`, revisão E1 |
| Gold point-in-time (20 features) | ✅ | revisão E1: 0 divergências em 722.566 valores; teste de paridade |
| Split temporal em 5 janelas | ✅ | `test_split_temporal_sem_sobreposicao` |
| Dummy, LR, RF, XGBoost, Optuna, ablação A×B, estresse C1 a C4 | ✅ | `resultados.json`, MLflow, revisão E2 |
| Calibração (sigmoide × isotônica) | ✅ | Brier no teste 0,000588 → 0,000551 |
| Política de 3 níveis por custo + sensibilidade | ✅ | política recalculada à mão pelo revisor, diferença 0 |
| SHAP global e local (log-odds) | ✅ | teste: soma das contribuições = margem |
| MLflow: tracking, registry, alias champion, v1/v2 | ✅ | `docs/prints/mlflow-*.png` |
| API FastAPI (contrato da seção 8 da especificação) | ✅ | testes de integração + revisão E3-E5 |
| Redis como feature store, idempotência, rate limit | ✅ | testes |
| Redis Streams + worker (ACK após persistir, XAUTOCLAIM, DLQ) | ✅ | testes de recuperação e DLQ |
| Persistência no BigQuery (predictions, decisions + views sem duplicata) | ✅ | `v_auditoria_diaria` |
| Challenger em modo sombra (cortes de mesma taxa de alerta) | ✅ | teste "shadow nunca muda a decisão" |
| Replay, rótulo em D+30, safra madura, PSI | ✅ rodando na VPS | `/architecture/status`, `/metrics` |
| Interface com 5 páginas | ✅ no ar | prints em `docs/prints/` |
| 41 testes automatizados | ✅ 41/41 | `reports/test_results/` |
| Teste de carga | ✅ | `carga.json`: 7,5 req/s, p50 de 512 ms ponta a ponta, 0% de erro |
| Trava de custo no GCP | ✅ | orçamento de R$ 50 + cota de 20 GiB/dia; gasto até agora: cerca de 1,5 GiB faturado (faixa grátis) |
| Documentação | ✅ | README, `docs/*.md`, `DIARIO.md`, roteiro de entrevista |

## Pendências para o Douglas (precisam de você)

1. **DNS na Hostinger** (eu não tinha acesso). Crie os dois registros:
   - `A  api-fraude → 2.29.40.32`
   - `CNAME  fraude → cname.vercel-dns.com`

   Depois me avise: eu adiciono o domínio na Vercel, troco a URL da API e acrescento `api-fraude.zuperdata.com.br` no Caddy.
2. **Chave órfã no Redis do WhatsApp** (incidente explicado no DIARIO). Opcional, porque a chave é pequena e não interfere:
   `docker exec evolution-redis-1 redis-cli DEL fraud:replay:comando`
3. **Commit no repositório SITES:**
   - a pasta `zuperdata_site/douglas-portifolio/` já está no ar, mas sem commit;
   - também estão sem commit as funções do BestByBrasil em `Infinity/docs/etl` (as de 14/11).
4. **Indexação do portfólio no Google:** ele está com `noindex`. Se quiser aparecer no Google, eu tiro.
5. **Antes da entrevista:** rodar `docker compose run --rm loader` na VPS. Assim os 3 cenários voltam a reproduzir o resultado da seleção, porque transações feitas na demo adiantam o histórico do cartão.

## Riscos conhecidos

- **Resultados otimistas:** a base sintética tem atalhos (`docs/limitations.md`).
- **VPS:** é compartilhada e pequena; a API tem 0,8 vCPU.
- **Rollback:** demonstrado só no registry (v1 → v2), não com troca ao vivo.
- **Optuna:** empatou com o modelo base.
