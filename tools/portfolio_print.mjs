import { chromium } from "playwright-core";
const EXE = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
const b = await chromium.launch({ executablePath: EXE });
for (const [w, h, nome] of [[1440, 900, "1440"], [390, 844, "390"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));
  await p.goto(process.argv[2], { waitUntil: "networkidle" });
  await p.evaluate(() => document.querySelector("#projetos")?.scrollIntoView());
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${process.env.TEMP}/port-${nome}.png` });
  const ov = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(nome, "overflow:", ov, "erros:", erros.length ? erros : "nenhum");
}
await b.close();
