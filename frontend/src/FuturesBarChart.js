// -------------------------------------------------------------
// FuturesBarChart.js 
// -------------------------------------------------------------
import React, { useEffect, useMemo, useRef } from "react";
import Highcharts from "highcharts/highstock";
import HighchartsReact from "highcharts-react-official";
import darkUnica from "highcharts/themes/dark-unica";
import throttle from "lodash.throttle";

if (typeof darkUnica === "function") darkUnica(Highcharts);

/* 過濾無效 OHLC 行 */
const sanitize = rows =>
  rows.filter(
    r =>
      r.ts &&
      [r.Open, r.High, r.Low, r.Close].every(v => v != null && !isNaN(v))
  );

export default function FuturesBarChart({ kbars = [], lastPrice = null }) {
  const chartRef = useRef(null);

  /* 1. 轉成 [ts, O, H, L, C] & [ts, Vol] */
  const [ohlc, volumes] = useMemo(() => {
    const sorted = sanitize(kbars).sort((a, b) => a.ts - b.ts);
    return [
      sorted.map(r => [Number(r.ts), r.Open, r.High, r.Low, r.Close]),
      sorted.map(r => [Number(r.ts), r.Volume])
    ];
  }, [kbars]);

  /* 2. 基本 Option（只建一次） */
  const baseOptions = useMemo(
    () => ({
      chart: {
        height: 340,
        backgroundColor: "#0d0d14",
        pinchType: "x",
        animation: false,
        style: { fontFamily: "Helvetica Neue, Roboto, sans-serif" }
      },

      rangeSelector: { enabled: false },
      navigator: { enabled: false },
      scrollbar:  { enabled: false },

      tooltip: {
        split: true,
        shared: false,
        backgroundColor: "rgba(20,20,30,.85)",
        borderWidth: 0,
        shadow: false,
        xDateFormat: "%Y-%m-%d",
        style: { fontSize: "12px" }
      },

      xAxis: {
        type: "datetime",
        crosshair: { width: 1, color: "#00e0ff" },
        labels: { style: { color: "#889", fontSize: "11px" } },
        tickLength: 5,
        tickColor: "#333",
        minPadding: 0.05,
        maxPadding: 0.1
      },

      yAxis: [
        {
          /* 價格軸 — 左側 */
          opposite: false,
          labels: { align: "left", x: -6, style: { color: "#ccc" } },
          title : { text: "價格", style: { color: "#ccc", fontSize: "12px" } },
          height: "72%",
          gridLineColor: "#222",
          lineWidth: 1
        },
        {
          /* 成交量軸 — 左側下半部 */
          top: "75%",
          height: "23%",
          offset: 0,
          opposite: false,
          labels: { align: "left", x: -6, style: { color: "#ccc" } },
          title : { text: "成交量", style: { color: "#ccc", fontSize: "12px" } },
          gridLineColor: "#222",
          lineWidth: 1
        }
      ],

      plotOptions: {
        series: {
          dataGrouping: { enabled: false },
          states: { inactive: { opacity: 1 } }
        },
        candlestick: {
          pointWidth: 9,        
          lineColor: "#ff4d4f",
          upLineColor: "#1ad1ff"
        },
        column: {
          groupPadding: 0.25,
          pointPadding: 0.05
        }
      },

      credits: { enabled: false },

      series: [
        {
          id: "kbar",
          type: "candlestick",
          name: "TXF",
          data: [],
          color: "#ff4d4f",
          upColor: "#1ad1ff",
          borderRadius: 2
        },
        {
          id: "volume",
          type: "column",
          name: "Volume",
          yAxis: 1,
          data: [],
          color: "#555",
          tooltip: { valueDecimals: 0 }
        }
      ]
    }),
    []
  );

  /* 3. 資料更新 (60 ms 節流) */
  const throttledRedraw = useRef(throttle(ch => ch.redraw(), 60));

  useEffect(() => {
    const ch = chartRef.current?.chart;
    if (!ch) return;
    const [kbarSeries, volumeSeries] = ch.series;
    kbarSeries.setData(ohlc, false);
    volumeSeries.setData(volumes, false);
    throttledRedraw.current(ch);
  }, [ohlc, volumes]);

  /* 4. 最新價藍點 */
  useEffect(() => {
    if (!lastPrice) return;
    const ch = chartRef.current?.chart;
    if (!ch) return;

    const now = Date.now();
    const scatter =
      ch.get("last-pt") ||
      ch.addSeries(
        {
          id: "last-pt",
          type: "scatter",
          name: "Last",
          data: [],
          yAxis: 0,
          marker: { radius: 6, fillColor: "#00e0ff" },
          enableMouseTracking: false,
          animation: false
        },
        false
      );

    scatter.setData([[now, lastPrice]], false);

    const axis = ch.xAxis[0];
    const max  = axis.max,
          min  = axis.min;
    if (now > max - (axis.dataMax - axis.dataMin) * 0.02) {
      axis.setExtremes(min, now + 60 * 1000, false, false); 
    }

    throttledRedraw.current(ch);
  }, [lastPrice]);

  /* 5. render */
  return (
    <HighchartsReact
      highcharts={Highcharts}
      constructorType="stockChart"
      options={baseOptions}
      ref={chartRef}
      immutable={false}
    />
  );
}
