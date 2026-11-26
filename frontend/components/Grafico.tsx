"use client";
import dynamic from "next/dynamic";
import type { PlotParams } from "react-plotly.js";

const Plot = dynamic(async () => {
  const Plotly = await import("plotly.js-dist-min");
  const factory = (await import("react-plotly.js/factory")).default;
  return factory(Plotly);
}, { ssr: false, loading: () => <div className="esqueleto" style={{ height: 240 }} aria-label="carregando gráfico" /> });

export const COR = { protecao: "#3DDC97", intel: "#7FA7D9", risco: "#F0716A", atencao: "#E8B04A", zuper: "#19B36B", neutro: "#5B6B80", texto: "#E8EEF5", sub: "#A3B0C0", linha: "#1F2A38", roxo: "#A99BE0" };

const BASE: Partial<Plotly.Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#A3B0C0", family: "Geist, Inter, system-ui, sans-serif", size: 12 },
  margin: { l: 56, r: 16, t: 24, b: 46 },
  xaxis: { gridcolor: "#172130", zerolinecolor: "#1F2A38", linecolor: "#1F2A38" },
  yaxis: { gridcolor: "#172130", zerolinecolor: "#1F2A38", linecolor: "#1F2A38" },
  legend: { orientation: "h", y: -0.2, font: { size: 11 } },
  hoverlabel: { bgcolor: "#1C2838", bordercolor: "#2C3A4D", font: { color: "#E8EEF5", family: "Geist, system-ui, sans-serif" } },
  separators: ",.",
};

export default function Grafico({ data, layout, altura = 320 }: { data: PlotParams["data"]; layout?: Partial<Plotly.Layout>; altura?: number }) {
  const l = { ...BASE, ...layout, xaxis: { ...BASE.xaxis, ...(layout?.xaxis || {}) }, yaxis: { ...BASE.yaxis, ...(layout?.yaxis || {}) }, height: altura, autosize: true };
  return <Plot data={data} layout={l} config={{ displaylogo: false, responsive: true, displayModeBar: false }} style={{ width: "100%" }} useResizeHandler />;
}
