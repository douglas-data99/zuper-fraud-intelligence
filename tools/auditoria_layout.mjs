// Auditoria de layout: textos sobrepostos, texto cortado e conteúdo vazando, nas 7 páginas e 3 larguras.
// Uso: node auditoria_layout.mjs [base] [pasta-prints]
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const EXE = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
const BASE = process.argv[2] || "http://localhost:3000";
const OUT = process.argv[3] || "";
const ROTAS = ["/", "/operacoes", "/simulador", "/decisao", "/lab", "/monitoramento", "/mlops"];
const TAM = [[1440, 900, false], [1920, 1080, false], [390, 844, true]];
if (OUT) mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: EXE });
const achados = [];
for (const [w, h, m] of TAM) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: m, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  for (const r of ROTAS) {
    await p.goto(BASE + r, { waitUntil: "networkidle" });
    await p.waitForTimeout(1800);
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(800);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(400);
    const res = await p.evaluate(() => {
      const visivel = (el) => {
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
        let a = el.parentElement;
        while (a) { const s = getComputedStyle(a); if (s.display === "none" || Number(s.opacity) === 0 || s.visibility === "hidden") return false; a = a.parentElement; }
        return true;
      };
      const nome = (el) => {
        const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
        return `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : el.getAttribute?.("class") ? "." + el.getAttribute("class").split(" ")[0] : ""} "${t}"`;
      };
      const main = document.querySelector("main") || document.body;
      // folhas de texto (HTML) e textos de SVG (Plotly)
      const els = [];
      for (const el of main.querySelectorAll("*")) {
        if (el.closest(".modebar")) continue;
        const temTexto = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!temTexto) continue;
        if (el.tagName === "tspan" && el.parentElement?.tagName === "text") continue;
        const rc = el.getBoundingClientRect();
        if (rc.width < 1 || rc.height < 1 || !visivel(el)) continue;
        const fechado = el.closest("details:not([open])");
        if (fechado && !el.closest("summary")) continue;
        // recorte pelos ancestrais que cortam conteúdo (overflow != visible)
        let clip = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 };
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX !== "visible" || s.overflowY !== "visible") {
            const ar = a.getBoundingClientRect();
            clip = { left: Math.max(clip.left, ar.left), top: Math.max(clip.top, ar.top), right: Math.min(clip.right, ar.right), bottom: Math.min(clip.bottom, ar.bottom) };
          }
        }
        if (clip.right - clip.left < 1 || clip.bottom - clip.top < 1) continue;
        // retângulo do texto (Range) em HTML, para não usar a caixa inteira do bloco
        let qs = [rc];
        if (!(el instanceof SVGElement)) {
          qs = [];
          for (const n of el.childNodes) {
            if (n.nodeType !== 3 || !n.textContent.trim()) continue;
            const rg = document.createRange();
            rg.selectNodeContents(n);
            qs.push(...[...rg.getClientRects()].filter((x) => x.width > 0));
          }
        }
        qs = qs.map((q) => ({ left: Math.max(q.left, clip.left), top: Math.max(q.top, clip.top), right: Math.min(q.right, clip.right), bottom: Math.min(q.bottom, clip.bottom) }))
          .filter((q) => q.right - q.left > 0 && q.bottom - q.top > 0);
        if (qs.length) els.push({ el, qs });
      }
      const sob = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const A = els[i], B = els[j];
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        let melhor = null;
        for (const a of A.qs) for (const c of B.qs) {
          const x = Math.min(a.right, c.right) - Math.max(a.left, c.left);
          const y = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
          if (x > 3 && y > 3 && (!melhor || x * y > melhor[0] * melhor[1])) melhor = [x, y];
        }
        if (melhor) sob.push(`${nome(A.el)} × ${nome(B.el)} (${Math.round(melhor[0])}x${Math.round(melhor[1])})`);
      }
      const cortados = [];
      for (const el of main.querySelectorAll("*")) {
        if (el instanceof SVGElement || !visivel(el)) continue;
        const cs = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          const intencional = ["auto", "scroll"].includes(cs.overflowX) || el.closest(".tabela-rolar") || el.tagName === "INPUT" || el.tagName === "SELECT";
          if (!intencional && (cs.textOverflow === "ellipsis" || cs.overflowX === "hidden")) cortados.push(`${nome(el)} cortado (${el.scrollWidth}>${el.clientWidth})`);
        }
      }
      const vaza = document.documentElement.scrollWidth > innerWidth + 1;
      return { sob: sob.slice(0, 40), cortados: cortados.slice(0, 30), vaza };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/${(r === "/" ? "inicio" : r.slice(1))}-${w}.png`, fullPage: true });
    achados.push({ rota: r, largura: w, ...res });
    console.log(`${r} @${w}: sobreposições ${res.sob.length}, cortados ${res.cortados.length}${res.vaza ? ", ROLAGEM LATERAL" : ""}`);
    for (const s of res.sob) console.log("   ×", s);
    for (const c of res.cortados) console.log("   ✂", c);
  }
  await ctx.close();
}
if (OUT) writeFileSync(`${OUT}/auditoria.json`, JSON.stringify(achados, null, 2));
await b.close();
