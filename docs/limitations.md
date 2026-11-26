# Limitações (o que este projeto NÃO prova)

1. **Os dados são sintéticos e têm atalhos.** A Sparkov tem três atalhos que facilitam o trabalho do modelo:
   - nenhuma fraude passa de US$ 1.376;
   - as fraudes vêm em rajadas: cerca de 10 por cartão em 2 dias, e 976 dos 999 cartões têm fraude;
   - há cartões criados só para fraude, que ficam ativos 1 ou 2 dias.

   Sem as features de valor, a AP cai de 0,958 para 0,538. As métricas são um **teto otimista** e não se transferem para um banco real.
2. **Cliente novo (cold start).** Não há como avaliar. Depois de 2019, todo cartão com histórico curto é um cartão só de fraude, criado pelo gerador. Na demo, um cartão de histórico curto tende a cair em investigação, e isso é artefato, não mérito.
3. **Custos hipotéticos.** Custo de verificação, custo de análise, atrito e eficácia são premissas (USD). O "benefício líquido" é simulado e quer dizer valor **potencialmente** evitado, não dinheiro recuperado.
4. **Faltam variáveis importantes na vida real:**
   - dispositivo, IP, destinatário, saldo, Pix e canal;
   - grafo de contas e dispositivos compartilhados.

   Elas não existem na base e não foram inventadas.
5. **Fuso horário desconhecido.** A hora foi usada como está no arquivo.
6. **Rótulo atrasado só simulado.** A base não traz a data de confirmação da fraude. O replay libera o rótulo 30 dias **virtuais** depois do evento.
7. **Escala.**
   - A VPS é pequena (2 vCPU, 3,7 GB) e compartilhada com outro sistema. A API está limitada a 0,8 vCPU.
   - Teste de carga: 300 requisições, 7,5 req/s, 0% de erro.
   - Não há afirmação de capacidade bancária. Para isso seriam necessários teste de carga com volume real, réplicas e redundância.
8. **Interação na demo e replay compartilham o tempo.** Uma transação feita no simulador acontece no relógio virtual atual, ou até 1 dia depois, conforme a hora escolhida. Muitas transações manuais no mesmo cartão podem adiantar o histórico desse cartão em relação ao replay.
9. **Persistência "pelo menos uma vez".** Se o worker cair entre a carga no BigQuery e o ACK, o lote é recarregado. As análises usam as visões `v_predictions` e `v_decisions`, que removem as duplicatas pelo `tx_id`.
10. **Rollback.** Está documentado e o registry guarda a versão 1 do modelo. Mas a versão 1 foi substituída por um bug, então a troca de versão não foi demonstrada ao vivo.
11. **Optuna.** 25 trials empataram com o modelo base. A busca não foi exaustiva.
12. **O teste foi lido 3 vezes:**
    - ensaio de depuração;
    - execução final;
    - reexecução por causa de bugs apontados na revisão (o modelo servia árvores a mais e a grade de cortes era grossa).

    Nenhuma escolha de modelo, calibração ou corte usou o teste. Mesmo assim, isso está declarado em `reports/metrics/leituras_do_teste.json`.
