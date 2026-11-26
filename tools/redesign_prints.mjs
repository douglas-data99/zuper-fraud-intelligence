// Evidências do redesign: prints antes (produção atual) × depois (build local), testes de interação e conferência numérica.
// Uso: node redesign_prints.mjs [antes|depois|tudo]
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const EXE = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
const ANTES = process.env.ANTES || "https://zuper-fraud-intelligence.vercel.app";
const DEPOIS = process.env.DEPOIS || "http://localhost:3000";
const OUT = process.env.OUT || "../docs/redesign";
const modo = process.argv[2] || "tudo";
const TAMANHOS = [["1440", 1440, 900, false], ["1920", 1920, 1080, false], ["390", 390, 844, true]];
const ROTAS = { antes: ["/", "/simulador", "/decisao", "/lab", "/mlops"], depois: ["/", "/operacoes", "/simulador", "/decisao", "/lab", "/monitoramento", "/mlops"] };
const nomeRota = (r) => (r === "/" ? "inicio" : r.slice(1));

const browser = await chromium.launch({ executablePath: EXE, args: ["--force-color-profile=srgb"] });
const relatorio = { gerado_em: new Date().toISOString(), erros_console: [], verificacoes: [] };
const ok = (nome, cond, det = "") => { relatorio.verificacoes.push({ nome, ok: !!cond, det }); console.log(cond ? "OK  " : "FALHA", nome, det); };

async function contexto(w, h, movel) {
  return browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: movel ? 2 : 1, isMobile: movel, hasTouch: movel, colorScheme: "dark" });
}

async function prints(fase, base) {
  mkdirSync(`${OUT}/${fase}`, { recursive: true });
  for (const [rot, w, h, movel] of TAMANHOS) {
    const ctx = await contexto(w, h, movel);
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" && fase === "depois") relatorio.erros_console.push(`${page.url()} ${m.text()}`); });
    for (const r of ROTAS[fase]) {
      await page.goto(base + r, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${fase}/${nomeRota(r)}-${rot}.png` });
      if (rot !== "1920") await page.screenshot({ path: `${OUT}/${fase}/${nomeRota(r)}-${rot}-inteira.png`, fullPage: true });
      if (fase === "depois") {
        const largura = await page.evaluate(() => document.documentElement.scrollWidth);
        ok(`sem rolagem lateral ${r} @${rot}`, largura <= w + 1, `scrollWidth=${largura}`);
      }
    }
    await ctx.close();
  }
}

async function interacoes() {
  const ctx = await contexto(1440, 900, false);
  const page = await ctx.newPage();
  // 1) números-chave da visão executiva
  // 0) tela inicial: apresentação interativa
  await page.goto(DEPOIS + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Iniciar apresentação" }).click();
  await page.waitForTimeout(3600);
  ok("apresentação avança sozinha em 3 s", (await page.locator("[aria-live=polite]").first().innerText()).startsWith("2 de"));
  await page.locator("button[aria-label^='Pausar']").first().hover();
  await page.getByRole("button", { name: /Pausar/ }).first().click();
  for (let k = 0; k < 20; k++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  ok("navegação manual chega à última etapa", (await page.locator("[aria-live=polite]").first().innerText()).startsWith("18 de"));
  await page.getByRole("button", { name: "Reiniciar" }).click();
  ok("reiniciar volta ao início", (await page.locator("[aria-live=polite]").first().innerText()).trim() === "—");
  const logosExternas = await page.evaluate(() => [...document.images].filter((i) => !i.src.startsWith(location.origin)).length);
  ok("logos carregadas localmente", logosExternas === 0, `${logosExternas} externas`);
  await page.goto(DEPOIS + "/operacoes", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const txt = await page.locator("main").innerText();
  for (const n of ["555.719", "2.145", "38.562.903", "1.133.325", "1.029.297", "551.169", "1.647", "2.903", "1.063.240", "99,18%", "0,30%", "0,52%", "0,82%", "99,3%"])
    ok(`número na visão executiva: ${n}`, txt.includes(n));
  ok("ações somam 555.719", 551169 + 1647 + 2903 === 555719);
  await page.getByText("Ver detalhamento").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/depois/inicio-detalhamento-1440.png`, fullPage: true });
  await page.getByText("Visão técnica do modelo").click();
  await page.waitForTimeout(1500);
  const tec = await page.locator("details.recolhe").innerText();
  ok("visão técnica abre com AP do Champion", tec.includes("0,958") || tec.includes("0.958"));

  // 2) simulador: cenário + what-if + transação com evento
  await page.goto(DEPOIS + "/simulador", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const cen = page.getByRole("group", { name: "Cenários reproduzíveis" }).getByRole("button");
  ok("cenários carregados da API", (await cen.count()) === 3, `${await cen.count()} cenários`);
  await cen.nth(2).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Simular sem gravar (what-if)" }).click();
  await page.getByText(/nada foi gravado/i).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500);
  ok("what-if responde sem gravar", true);
  await page.screenshot({ path: `${OUT}/depois/simulador-whatif-1440.png`, fullPage: true });
  const nova = page.getByRole("button", { name: "Nova compra" });
  if (await nova.count()) await nova.first().click();
  await cen.nth(0).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /^Pagar/ }).click();
  await page.getByText("Transação registrada com evento").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(6000);
  const tr = await page.locator("main").innerText();
  ok("transação com evento registrada", tr.includes("Transação registrada com evento"));
  ok("trilha mostra persistência assíncrona", tr.includes("persistência assíncrona"));
  await page.screenshot({ path: `${OUT}/depois/simulador-transacao-1440.png`, fullPage: true });

  // 3) motor de decisão: sliders na janela policy; teste somente leitura
  await page.goto(DEPOIS + "/decisao", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const ben = async () => (await page.locator("tr.destaque").first().innerText());
  const antes = await ben();
  const slider = page.locator('input[type="range"]').first();
  await slider.focus();
  for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  const depois = await ben();
  ok("slider de corte recalcula o benefício (janela policy)", antes !== depois, `${antes} → ${depois}`);
  await page.getByRole("button", { name: "Voltar à política congelada" }).click();
  await page.waitForTimeout(400);
  ok("volta à política congelada", (await ben()) === antes);
  const blocoTeste = page.locator(".secao.card", { hasText: "Política congelada aplicada ao teste" });
  ok("bloco do teste é somente leitura (sem inputs)", (await blocoTeste.locator("input, select, button").count()) === 0);
  await page.screenshot({ path: `${OUT}/depois/decisao-1440-inteira.png`, fullPage: true });

  // 4) monitoramento: alternar granularidade
  await page.goto(DEPOIS + "/monitoramento", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Semanal" }).click();
  await page.waitForTimeout(1500);
  ok("monitoramento alterna para semanal", (await page.getByRole("button", { name: "Semanal" }).getAttribute("aria-pressed")) === "true");
  await page.screenshot({ path: `${OUT}/depois/monitoramento-semanal-1440.png` });
  await ctx.close();

  // 5) menu móvel
  const m = await contexto(390, 844, true);
  const p2 = await m.newPage();
  await p2.goto(DEPOIS + "/", { waitUntil: "networkidle" });
  await p2.getByRole("button", { name: "Abrir menu" }).click();
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: `${OUT}/depois/menu-movel-390.png` });
  await p2.getByRole("link", { name: "Monitoramento do modelo" }).click();
  await p2.waitForURL("**/monitoramento");
  ok("menu móvel navega e fecha", !(await p2.locator(".lateral.aberta").count()));
  await m.close();
}

if (modo === "antes" || modo === "tudo") await prints("antes", ANTES);
if (modo === "telas") await prints("depois", DEPOIS);
if (modo === "depois" || modo === "tudo") { await prints("depois", DEPOIS); await interacoes(); }
mkdirSync(OUT, { recursive: true });
if (modo !== "antes") writeFileSync(`${OUT}/verificacao.json`, JSON.stringify(relatorio, null, 2));
console.log("erros de console:", relatorio.erros_console.length, relatorio.erros_console.slice(0, 5));
await browser.close();
