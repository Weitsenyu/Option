import React from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";

export default function VolumeSummaryChart({ chainRows = [] }) {
  const data = chainRows.reduce(
    (acc, r) => {
      const i = acc.map.get(r.strike) ?? acc.series.length;
      if (acc.map.has(r.strike) === false) {
        acc.series.push([r.strike, 0]);
        acc.map.set(r.strike, i);
      }
      const vol = +r.volume || 0;
      acc.series[i][1] += r.cp === "C" ? vol : -vol;
      return acc;
    },
    { series: [], map: new Map() }
  ).series.sort((a, b) => a[0] - b[0]);

  const options = {
    chart: { type: "column" },
    title: { text: "成交量分佈" },
    xAxis: { title: { text: "Strike" } },
    yAxis: { title: { text: "Volume (+Call / -Put)" } },
    series: [{ name: "Volume", data }],
    tooltip: {
      pointFormatter() {
        return `<b>${this.y > 0 ? "Call" : "Put"}：${Math.abs(this.y)}</b>`;
      },
    },
  };
  return <HighchartsReact highcharts={Highcharts} options={options} />;
}
