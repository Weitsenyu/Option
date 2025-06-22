//-------------------------------------------------------------
// OIHistogram.js 
//-------------------------------------------------------------
import React, { useMemo } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";

export default function OIHistogram({ data = [], exp = "" }) {
  /* 依到期日過濾 + 合併 */
  const merged = useMemo(() => {
    const m = new Map(); // strike → {C:0,P:0}
    data
      .filter(r => !exp || r.expiration === exp)
      .forEach(r => {
        if (!m.has(r.strike)) m.set(r.strike, { C: 0, P: 0 });
        m.get(r.strike)[r.cp] = r.volume; // **成交量**
      });
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [data, exp]);

  /* Call 上、Put 下 */
  const call = merged.map(([k, v]) => [k, v.C || 0]);
  const put  = merged.map(([k, v]) => [k, -(v.P || 0)]);

  /* Highcharts 設定 */
  const options = {
    chart: { type: "column", backgroundColor: "transparent", height: 260 },
    title: { text: `Volume Histogram (${exp})`, style: { color: "#fff" } },
    xAxis: {
      type: "linear",
      tickPixelInterval: 80,
      labels: { style: { color: "#ccc" } }
    },
    yAxis: {
      title: { text: "Volume (口)", style: { color: "#ccc" } },
      gridLineColor: "#333",
      labels: { style: { color: "#ccc" } },
      plotLines: [{ value: 0, width: 1, color: "#888" }]
    },
    tooltip: {
      formatter() {
        return `<b>${this.x}</b><br/>${this.series.name}：${Math.abs(this.y)}`;
      }
    },
    plotOptions: { column: { pointPadding: 0.05, groupPadding: 0.02 } },
    series: [
      { name: "Call", data: call, color: "#ff4d4f" },
      { name: "Put", data: put, color: "#00c2ff" }
    ],
    legend: { itemStyle: { color: "#ccc" } },
    credits: { enabled: false }
  };

  return <HighchartsReact highcharts={Highcharts} options={options} />;
}
