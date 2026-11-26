// Render quadro a quadro (30 fps) do video.html. Uso: node render.mjs [amostra|tudo]
import { chromium } from "../tools/node_modules/playwright-core/index.mjs";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
const EXE = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
const dados = { roteiro: JSON.parse(readFileSync("roteiro.json", "utf8")), duracoes: JSON.parse(readFileSync("_build/duracoes.json", "utf8")),
                palavras: JSON.parse(readFileSync("_build/palavras.json", "utf8")) };
const modo = process.argv[2] || "amostra";
const b = await chromium.launch({ executablePath: EXE, args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await p.addInitScript((d) => { window.__DADOS__ = d; }, dados);
await p.goto(pathToFileURL(process.cwd() + "/video.html").href);
await p.waitForFunction(() => window.pronto === true, null, { timeout: 60000 });
const dur = await p.evaluate(() => window.DURACAO);
const falas = await p.evaluate(() => window.FALAS);
if (modo === "amostra") {
  mkdirSync("_build/amostra", { recursive: true });
  for (const f of falas) for (const frac of [0.25, 0.85]) {
    const t = f.ini + frac * (dados.duracoes[f.id]);
    await p.evaluate((x) => window.irPara(x), t);
    await p.screenshot({ path: `_build/amostra/${f.id}-${Math.round(frac * 100)}.jpg`, type: "jpeg", quality: 80 });
  }
  console.log("amostra ok, duração", dur.toFixed(1));
} else {
  rmSync("_build/quadros", { recursive: true, force: true }); mkdirSync("_build/quadros", { recursive: true });
  const n = Math.ceil(dur * 30);
  for (let i = 0; i < n; i++) {
    await p.evaluate((x) => window.irPara(x), i / 30);
    await p.screenshot({ path: `_build/quadros/${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 88 });
    if (i % 900 === 0) console.log("quadro", i, "de", n);
  }
  console.log("render ok", n, "quadros");
}
await b.close();
