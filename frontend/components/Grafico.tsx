"use client";
import dynamic from "next/dynamic";
import type { PlotParams } from "react-plotly.js";

const Plot = dynamic(async () => {
  const Plotly = await import("plotly.js-dist-min");
  const factory = (await import("react-plotly.js/factory")).default;
  return factory(Plotly);
}, { ssr: false, loading: () => <div className="estado">carregando gráfico…</div> });

const BASE: Partial<Plotly.Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#a9b4c2", family: "Inter, system-ui, sans-serif", size: 12 },
  margin: { l: 56, r: 16, t: 28, b: 46 },
  xaxis: { gridcolor: "#1f2937", zerolinecolor: "#243041" },
  yaxis: { gridcolor: "#1f2937", zerolinecolor: "#243041" },
  legend: { orientation: "h", y: -0.22 },
  hoverlabel: { bgcolor: "#141a23", bordercolor: "#243041", font: { color: "#e8edf3" } },
};

export default function Grafico({ data, layout, altura = 320 }: { data: PlotParams["data"]; layout?: Partial<Plotly.Layout>; altura?: number }) {
  const l = { ...BASE, ...layout, xaxis: { ...BASE.xaxis, ...(layout?.xaxis || {}) }, yaxis: { ...BASE.yaxis, ...(layout?.yaxis || {}) }, height: altura, autosize: true };
  return <Plot data={data} layout={l} config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] }} style={{ width: "100%" }} useResizeHandler />;
}
