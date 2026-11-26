// Prints reais: MLflow (local, mesmo banco publicado na VPS) e as 5 páginas no ar.
// Uso: node prints.mjs [mlflow|site|tudo]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const EXE = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
const SITE = process.env.SITE || "https://zuper-fraud-intelligence.vercel.app";
const MLFLOW = process.env.MLFLOW || "http://127.0.0.1:5005";
const OUT = "../docs/prints";
const PUB = "../frontend/public/prints";
mkdirSync(OUT, { recursive: true });
mkdirSync(PUB, { recursive: true });
const modo = process.argv[2] || "tudo";

const browser = await chromium.launch({ executablePath: EXE, args: ["--force-color-profile=srgb"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: "dark" });
const page = await ctx.newPage();
const espera = (ms) => page.waitForTimeout(ms);

if (modo === "mlflow" || modo === "tudo") {
  const RUN = "30bbef2e151f427e8b300953f84fe21b";
  const alvos = [[`${MLFLOW}/#/experiments/1`, "mlflow-experimentos"], [`${MLFLOW}/#/models/zuper-fraud-xgb`, "mlflow-registry"],
                 [`${MLFLOW}/#/experiments/1/runs/${RUN}`, "mlflow-run-champion"], [`${MLFLOW}/#/experiments/1/runs/${RUN}/artifacts`, "mlflow-artefatos"]];
  for (const [url, nome] of alvos) {
    await page.goto(url, { waitUntil: "networkidle" });
    await espera(3500);
    for (const b of ["Close", "Fechar"]) { const x = page.getByRole("button", { name: b }); if (await x.count()) await x.first().click().catch(() => {}); }
    await page.keyboard.press("Escape");
    await espera(1200);
    await page.screenshot({ path: `${OUT}/${nome}.png` });
    if (nome === "mlflow-experimentos" || nome === "mlflow-registry") await page.screenshot({ path: `${PUB}/${nome}.png` });
  }
}

if (modo === "site" || modo === "tudo") {
  for (const [rota, nome, extra] of [["/", "01-centro-operacoes", 5000], ["/decisao", "03-motor-decisao", 3500], ["/lab", "04-data-science-lab", 4500], ["/mlops", "05-mlops", 6000]]) {
    await page.goto(`${SITE}${rota}`, { waitUntil: "networkidle" });
    await espera(extra);
    await page.screenshot({ path: `${OUT}/${nome}.png` });
    await page.screenshot({ path: `${OUT}/${nome}-inteira.png`, fullPage: true });
  }
  // simulador: cenário atípico -> pagamento real pela API
  await page.goto(`${SITE}/simulador`, { waitUntil: "networkidle" });
  await espera(3500);
  await page.screenshot({ path: `${OUT}/02-simulador-inicio.png` });
  for (const [botao, nome] of [["Habitual", "02-simulador-habitual"], ["Atípico", "02-simulador-atipico"], ["Ambíguo", "02-simulador-ambiguo"]]) {
    await page.getByRole("button", { name: new RegExp(`^${botao}`) }).click();
    await espera(2500);
    await page.getByRole("button", { name: "Efetuar pagamento" }).click();
    await espera(9000);
    await page.screenshot({ path: `${OUT}/${nome}.png` });
    await page.screenshot({ path: `${OUT}/${nome}-inteira.png`, fullPage: true });
  }
}
await browser.close();
console.log("prints ok");
