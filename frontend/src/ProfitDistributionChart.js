//-------------------------------------------------------------
// ProfitDistributionChart.js 
//-------------------------------------------------------------
import React, { useMemo } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";

const MULT = 200; // TXO: 1 點 200 元

export default function ProfitDistributionChart({ rows = [], exp = "" }) {
  /* ---------- 1. 整理資料 ---------- */
  const snap = useMemo(() => {
    const arr = [];
    rows
      .filter(r => (!exp || r.expiration === exp) && +r.oi && +r.last)
      .forEach(r => {
        arr.push({
          K:   +r.strike,
          cp:  r.cp,
          oi:  Math.abs(+r.oi),
          prem:+r.last
        });
      });
    return arr;
  }, [rows, exp]);

  if (!snap.length) return null;

  /* ---------- 2. 價格格點 ---------- */
  const strikes = [...new Set(snap.map(d => d.K))].sort((a,b)=>a-b);
  const step    = strikes.length > 1 ? strikes[1]-strikes[0] : 50;
  const grid    = [strikes[0]-step, ...strikes, strikes.at(-1)+step];

  /* ---------- 3. 損益曲線（並計 Call / Put 貢獻） ---------- */
  const curve = grid.map(S => {
    let call = 0, put = 0;
    snap.forEach(({K,cp,oi,prem}) => {
      const intrinsic = cp==="C" ? Math.max(S-K,0) : Math.max(K-S,0);
      const p = (prem - intrinsic) * oi * MULT;
      cp==="C" ? (call+=p) : (put+=p);
    });
    return { x:S, y:call+put, c:call, p:put };
  });

  /* ---------- 4. Max Pain & 區間 ---------- */
  const maxNode   = curve.reduce((a,b)=> b.y>a.y ? b : a);
  const maxPainX  = maxNode.x, maxPainY = maxNode.y;

  const bandPts   = curve.filter(pt => pt.y >= 0.9 * maxPainY).map(pt => pt.x);
  const bandMin   = Math.min(...bandPts), bandMax = Math.max(...bandPts);

  /* ---------- 5. Y 軸格式 ---------- */
  const fmtY = v => {
    const sign = v<0?"−":"";
    const n = Math.abs(v);
    if(n>=1e9)  return sign+(n/1e8).toFixed(0)+"億";
    if(n>=1e8)  return sign+(n/1e8).toFixed(1)+"億";
    if(n>=1e7)  return sign+(n/1e7).toFixed(0)+"千萬";
    if(n>=1e6)  return sign+(n/1e6).toFixed(1)+"百萬";
    return sign+n.toLocaleString();
  };

  /* ---------- 6. Highcharts ---------- */
  const options = {
    chart :{ type:"column", height:320, backgroundColor:"transparent" },
    title :{ text:`損益分布 (${exp})`, style:{ color:"#fff" } },
    xAxis :{
      title:{ text:"履約價", style:{ color:"#ccc" } },
      labels:{ style:{ color:"#ccc", fontSize:"10px" } },
      plotLines:[{
        color:"#ffd700", width:2, value:maxPainX, zIndex:4,
        label:{ text:`Max Pain ${maxPainX}`, style:{ color:"#ffd700", fontWeight:600 }, y:-8, rotation:0 }
      }],
      plotBands:[{
        from:bandMin, to:bandMax, color:"rgba(255,215,0,0.08)", zIndex:1
      }]
    },
    yAxis :{
      title:{ text:"賣方損益", style:{ color:"#ccc" } },
      labels:{ style:{ color:"#ccc" }, formatter(){ return fmtY(this.value);} },
      gridLineColor:"#333",
      plotLines:[{ value:0, width:1, color:"#888" }]
    },
    tooltip:{
      backgroundColor:"#1d1d27",
      borderColor:"#888",
      style:{ color:"#eee" },
      formatter(){
        const { c, p } = this.point;
        return `
          履約價 <b>${this.x}</b><br/>
          總損益 <b>${fmtY(this.y)}</b><br/>
          &nbsp;&nbsp;Call&nbsp; ${fmtY(c)}<br/>
          &nbsp;&nbsp;Put&nbsp;&nbsp; ${fmtY(p)}
        `;
      }
    },
    plotOptions:{
      column:{
        borderWidth:0, pointPadding:0.03, groupPadding:0,
        zones:[ {value:0,color:"#ff4d4f"}, {color:"#00b8ff"} ]
      }
    },
    series:[{
      name:"賣方 Profit",
      data:curve
    }],
    legend :{ enabled:false },
    credits:{ enabled:false }
  };

  return <HighchartsReact highcharts={Highcharts} options={options} />;
}
