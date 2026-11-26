"use client";
import dynamic from "next/dynamic";
import type { PlotParams } from "react-plotly.js";

const Plot = dynamic(async () => {
  const Plotly = await import("plotly.js-dist-min");
  const factory = (await import("react-plotly.js/factory")).default;
  return factory(Plotly);
}, { ssr: false, loading: () => <div className="esqueleto" style={{ height: 240 }} aria-label="carregando gráfico" /> });

export const COR = { protecao: "#34D399", intel: "#60A5FA", risco: "#F87171", atencao: "#FBBF24", neutro: "#64748B", texto: "#F1F5F9", sub: "#AEB9C9", linha: "#1E2A3D", roxo: "#A78BFA" };

const BASE: Partial<Plotly.Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#AEB9C9", family: "Geist, Inter, system-ui, sans-serif", size: 12 },
  margin: { l: 56, r: 16, t: 24, b: 46 },
  xaxis: { gridcolor: "#1A2537", zerolinecolor: "#243247", linecolor: "#243247" },
  yaxis: { gridcolor: "#1A2537", zerolinecolor: "#243247", linecolor: "#243247" },
  legend: { orientation: "h", y: -0.2, font: { size: 11 } },
  hoverlabel: { bgcolor: "#182335", bordercolor: "#243247", font: { color: "#F1F5F9", family: "Geist, system-ui, sans-serif" } },
  separators: ",.",
};

export default function Grafico({ data, layout, altura = 320 }: { data: PlotParams["data"]; layout?: Partial<Plotly.Layout>; altura?: number }) {
  const l = { ...BASE, ...layout, xaxis: { ...BASE.xaxis, ...(layout?.xaxis || {}) }, yaxis: { ...BASE.yaxis, ...(layout?.yaxis || {}) }, height: altura, autosize: true };
  return <Plot data={data} layout={l} config={{ displaylogo: false, responsive: true, displayModeBar: false }} style={{ width: "100%" }} useResizeHandler />;
}
