// Copia os artefatos gerados pela execução real do pipeline (reports/) para a interface.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
const origem = "../reports/metrics";
const destino = "public/data";
mkdirSync(destino, { recursive: true });
for (const f of ["resultados.json", "curvas.json", "politica_amostra.json", "serie_diaria_teste.json", "qualidade_silver.json",
                 "ingestao.json", "splits.json", "optuna_trials.csv", "sensibilidade_politica.csv", "teste_pytest.json", "carga.json"]) {
  if (existsSync(`${origem}/${f}`)) { copyFileSync(`${origem}/${f}`, `${destino}/${f}`); console.log("ok", f); }
  else console.log("ausente", f);
}
for (const f of ["shap_beeswarm.png", "curvas_teste.png", "calibracao_teste.png"]) {
  if (existsSync(`../reports/figures/${f}`)) copyFileSync(`../reports/figures/${f}`, `public/prints/${f}`);
}
