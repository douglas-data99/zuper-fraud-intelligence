"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { PlotParams } from "react-plotly.js";

const Plot = dynamic(async () => {
  const Plotly = await import("plotly.js-dist-min");
  const factory = (await import("react-plotly.js/factory")).default;
  return factory(Plotly);
}, { ssr: false, loading: () => <div className="esqueleto" style={{ height: 240 }} aria-label="carregando gráfico" /> });

export const COR = { protecao: "#3DDC97", intel: "#7FA7D9", risco: "#F0716A", atencao: "#E8B04A", zuper: "#19B36B", neutro: "#5B6B80", texto: "#E8EEF5", sub: "#A3B0C0", linha: "#1F2A38", roxo: "#A99BE0" };

const EIXO = { gridcolor: "#172130", zerolinecolor: "#1F2A38", linecolor: "#1F2A38", automargin: true, tickfont: { size: 11 } };
// legenda acima da área do gráfico, alinhada à esquerda: nunca disputa espaço com rótulos e títulos dos eixos
const LEGENDA_TOPO = { orientation: "h", x: 0, xanchor: "left", y: 1.02, yanchor: "bottom", font: { size: 11 }, bgcolor: "rgba(0,0,0,0)" };

const BASE: Partial<Plotly.Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#A3B0C0", family: "Geist, Inter, system-ui, sans-serif", size: 12 },
  margin: { l: 56, r: 16, t: 24, b: 46 },
  hoverlabel: { bgcolor: "#1C2838", bordercolor: "#2C3A4D", font: { color: "#E8EEF5", family: "Geist, system-ui, sans-serif" } },
  separators: ",.",
};

// telas estreitas: rótulos de categoria a -45° e no máximo 4 marcas em eixo numérico, para não encostarem
const ajusteX = (x: any, estreito: boolean) => {
  if (!estreito || x?.tickangle != null) return {};
  if (x?.type === "category") return { tickangle: -45 };
  if (x?.type !== "date" && x?.nticks == null && !x?.tickvals) return { nticks: 4 };
  if (x?.nticks != null && x.nticks > 4) return { nticks: 4 };
  return {};
};

const titulo = (eixo: any) => {
  if (!eixo?.title) return eixo;
  const t = typeof eixo.title === "string" ? { text: eixo.title } : eixo.title;
  return { ...eixo, title: { standoff: 12, font: { size: 11 }, ...t } };
};

function useEstreito() {
  const [e, setE] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const f = () => setE(mq.matches);
    f(); mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return e;
}

export default function Grafico({ data, layout, altura = 320 }: { data: PlotParams["data"]; layout?: Partial<Plotly.Layout>; altura?: number }) {
  const estreito = useEstreito();
  const series = (data || []).filter((d: any) => d.showlegend !== false && d.name).length;
  const temLegenda = layout?.showlegend !== false && series > 1;
  // legenda posicionada pela página dentro do gráfico (y >= 0) é respeitada; o resto vai para o topo
  const legendaDentro = layout?.legend && typeof layout.legend.y === "number" && layout.legend.y >= 0 && layout.legend.y < 1;
  const legend = legendaDentro ? { font: { size: 11 }, ...layout!.legend } : { ...LEGENDA_TOPO, ...(layout?.legend?.font ? { font: layout.legend.font } : {}) };
  const margem: Record<string, number> = { ...(BASE.margin as Record<string, number>), ...((layout?.margin as Record<string, number>) || {}) };
  if (temLegenda && !legendaDentro) margem.t = Math.max(margem.t ?? 0, 40);
  const l = {
    ...BASE, ...layout,
    xaxis: titulo({ ...EIXO, ...(layout?.xaxis || {}), ...ajusteX(layout?.xaxis, estreito) }),
    yaxis: titulo({ ...EIXO, ...(layout?.yaxis || {}) }),
    legend, margin: margem, height: altura, autosize: true,
  };
  if ((layout as any)?.yaxis2) (l as any).yaxis2 = titulo({ ...EIXO, ...(layout as any).yaxis2 });
  return <Plot data={data} layout={l as Partial<Plotly.Layout>} config={{ displaylogo: false, responsive: true, displayModeBar: false }} style={{ width: "100%" }} useResizeHandler />;
}
