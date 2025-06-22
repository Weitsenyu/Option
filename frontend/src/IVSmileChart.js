// -------------------------------------------------------------
// IVSmileChart.js 
// -------------------------------------------------------------
import React, { useMemo } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";

/* ---------- 工具 ---------- */
const normPdf = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
function normCdf(x) {                   
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const a1 = 0.319381530, a2 = -0.356563782,
        a3 = 1.781477937, a4 = -1.821255978,
        a5 = 1.330274429;
  const poly = (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t);
  const cdf  = 1 - normPdf(Math.abs(x)) * poly;
  return sign === 1 ? cdf : 1 - cdf;
}

/* --- Newton-Raphson 求 Implied Vol ------------------------ */
function impliedVol({ S, K, T, r, price, isCall }) {
  const phi = isCall ? 1 : -1;
  let sigma = 0.3,  iter = 0;

  while (iter++ < 50) {
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    const theo = phi * (S * normCdf(phi * d1) - K * Math.exp(-r * T) * normCdf(phi * d2));
    const vega = S * Math.sqrt(T) * normPdf(d1);
    const diff = theo - price;
    if (Math.abs(diff) < 1e-4) break;
    sigma = Math.max(1e-4, sigma - diff / vega);
  }
  return sigma * 100;       // %
}

export default function IVSmileChart({ chainRows = [], exp = "", futPrice = null }) {
  const series = useMemo(() => {
    const rows = chainRows.filter(r => r.expiration === exp && r.last > 0);
    if (!rows.length) return { call: [], put: [] };

    const S = futPrice || Math.max(...rows.map(r => r.strike));
    const T = Math.max(
      0.0001,
      (new Date(`${exp.replace(/\//g, "-")}T13:30:00+08:00`) - new Date()) / 3.154e10
    );

    const call = [], put = [];
    rows.forEach(r => {
      const iv = impliedVol({ S, K: r.strike, T, r: 0.01, price: r.last, isCall: r.cp === "C" });
      (r.cp === "C" ? call : put).push([r.strike, iv]);
    });
    call.sort((a, b) => a[0] - b[0]);  put.sort((a, b) => a[0] - b[0]);
    return { call, put };
  }, [chainRows, exp, futPrice]);

  const options = {
    chart : { type: "spline", backgroundColor: "transparent", height: 260 },
    title : { text: `IV Smile (${exp})`, style: { color: "#fff" } },
    xAxis : { title: { text: "Strike", style: { color: "#ccc" } },
              labels: { style: { color: "#ccc" } } },
    yAxis : { title: { text: "IV (%)", style: { color: "#ccc" } },
              labels: { style: { color: "#ccc" } } },
    tooltip: { pointFormat: "{series.name}: <b>{point.y:.2f}%</b>" },
    series : [
      { name: "Call", data: series.call, color: "#ff4d4f" },
      { name: "Put" , data: series.put , color: "#00c2ff" }
    ],
    legend : { itemStyle: { color: "#ccc" } },
    credits: { enabled: false }
  };

  return <HighchartsReact highcharts={Highcharts} options={options} />;
}
