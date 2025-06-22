//-------------------------------------------------------------
// PositionSimulatorModal.js  
//-------------------------------------------------------------
import React, { useMemo, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";

const MULT = 50; 

export default function PositionSimulatorModal({
  show, onClose, futPrice, expirations, rows
}) {
  /* ---------- 將日盤行情整理成 Map(exp → opts[]) ---------- */
  const byExp = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      if (!m.has(r.expiration)) m.set(r.expiration, []);
      m.get(r.expiration).push({
        K:+r.strike, cp:r.cp,
        bid:+r.bid1 || null, ask:+r.ask1 || null,
        last:+r.last || null, oi:+r.oi || 0
      });
    });
    m.forEach(arr => arr.sort((a,b)=>a.K-b.K));
    return m;
  }, [rows]);

  /* ---------- Legs ---------- */
  const [legs, setLegs] = useState([]);

  const addLeg = () => {
    const defExp = expirations[0];
    const firstK = byExp.get(defExp)?.[0]?.K || 0;
    setLegs(l => [...l,{ side:"BUY", cp:"C", exp:defExp, K:firstK, qty:1 }]);
  };
  const delLeg = i => setLegs(l => l.filter((_,idx)=>idx!==i));

  /* ---------- 網格 ---------- */
  const grid = useMemo(() => {
    const ks = rows.map(r=>+r.strike);
    const unique = [...new Set(ks)].sort((a,b)=>a-b);
    const step = unique[1]-unique[0] || 50;
    return [unique[0]-step, ...unique, unique.at(-1)+step];
  }, [rows]);

  /* ---------- payoff 計算：僅含 legs 的 exp ---------- */
  const payoffByExp = useMemo(() => {
    const map = new Map();
    legs.forEach(leg => {
      if (!map.has(leg.exp)) map.set(leg.exp, grid.map(S=>[S,0]));
    });
    legs.forEach(({side,cp,exp,K,qty})=>{
      const opt = byExp.get(exp)?.find(o=>o.K===K && o.cp===cp);
      if (!opt) return;
      const prem = opt.last ?? ((opt.bid||0)+(opt.ask||0))/2;
      const sgn  = side==="BUY"? 1 : -1;
      grid.forEach((S,idx)=>{
        const intrinsic = cp==="C"?Math.max(S-K,0):Math.max(K-S,0);
        const pnl = (intrinsic - prem) * qty * MULT * sgn;
        map.get(exp)[idx][1] += pnl;
      });
    });
    return map;
  }, [legs, grid, byExp]);

  /* --- total --- */
  const totalSeries = grid.map((p,i)=>[
    p,
    [...payoffByExp.values()].reduce((s,arr)=>s+arr[i][1],0)
  ]);

  /* ---------- Highcharts ---------- */
  const palette = ["#00b8ff","#ff7b00","#00ff8c","#ff4dff","#ffd700","#36d1dc","#ff9a9e"];
  const series  = [
    ...[...payoffByExp.entries()].map(([e,data],i)=>({
      name:e, data, color:palette[i%palette.length], lineWidth:2
    })),
    { name:"Total", data:totalSeries, color:"#ffffff", dashStyle:"Dash", lineWidth:2.5 }
  ];

  const chartOpt = {
    chart:{ type:"line", height:300, backgroundColor:"transparent" },
    title:{ text:"到期損益曲線", style:{ color:"#fff" } },
    xAxis:{ title:{ text:"標的價格", style:{ color:"#ccc" } }, labels:{ style:{ color:"#ccc" } } },
    yAxis:{ title:{ text:"損益", style:{ color:"#ccc" } }, labels:{ style:{ color:"#ccc" } } },
    tooltip:{
      shared:true, backgroundColor:"#1d1d27", borderColor:"#888", style:{ color:"#eee" },
      pointFormatter(){
        return `<span style="color:${this.color}">●</span> ${this.series.name}: <b>${this.y.toLocaleString()}</b><br/>`;
      }
    },
    series,
    legend:{
      layout:"horizontal", align:"center", verticalAlign:"bottom",
      itemStyle:{ color:"#ccc", fontSize:"11px" },
      itemHoverStyle:{ color:"#fff" },
      navigation:{ enabled:true, arrowSize:12, style:{ color:"#fff" } }
    },
    credits:{ enabled:false }
  };

  /* ---------- Render ---------- */
  if (!show) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-body" onClick={e=>e.stopPropagation()}>
        <h3>策略模擬</h3>

        <table className="leg-table">
          <thead>
            <tr><th>Buy/Sell</th><th>Call/Put</th><th>Strike</th><th>Qty</th><th>Exp</th><th>B&#124;A&#124;L&#124;OI</th><th></th></tr>
          </thead>
          <tbody>
            {legs.map((leg,i)=>{
              const opts = byExp.get(leg.exp) || [];
              const ks   = opts.filter(o=>o.cp===leg.cp);
              const sel  = ks.find(o=>o.K===leg.K) || {};
              return(
                <tr key={i}>
                  {/* Buy / Sell */}
                  <td>
                    <select value={leg.side}
                      onChange={e=>setLegs(l=>{l[i].side=e.target.value;return[...l];})}>
                      <option>BUY</option><option>SELL</option>
                    </select>
                  </td>

                  {/* Call / Put */}
                  <td>
                    <select value={leg.cp}
                      onChange={e=>{
                        const cp=e.target.value;
                        const firstK=opts.find(o=>o.cp===cp)?.K||0;
                        setLegs(l=>{l[i].cp=cp;l[i].K=firstK;return[...l];});
                      }}>
                      <option>C</option><option>P</option>
                    </select>
                  </td>

                  {/* Strike */}
                  <td>
                    <select value={leg.K}
                      onChange={e=>setLegs(l=>{l[i].K=+e.target.value;return[...l];})}>
                      {ks.map(o=><option key={o.K}>{o.K}</option>)}
                    </select>
                  </td>

                  {/* Qty */}
                  <td style={{width:"60px"}}>
                    <input type="number" value={leg.qty}
                      onChange={e=>setLegs(l=>{l[i].qty=+e.target.value;return[...l];})}/>
                  </td>

                  {/* Expiry */}
                  <td>
                    <select value={leg.exp}
                      onChange={e=>{
                        const exp=e.target.value;
                        const list=byExp.get(exp)||[];
                        const firstK=list.find(o=>o.cp===leg.cp)?.K||0;
                        setLegs(l=>{l[i].exp=exp;l[i].K=firstK;return[...l];});
                      }}>
                      {expirations.map(x=><option key={x}>{x}</option>)}
                    </select>
                  </td>

                  {/* Quote summary */}
                  <td style={{fontSize:".7rem",letterSpacing:0}}>
                    {(sel.bid??"-")}&#124;{(sel.ask??"-")}&#124;{(sel.last??"-")}&#124;{sel.oi??0}
                  </td>

                  {/* del */}
                  <td><button onClick={()=>delLeg(i)}>刪</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <button className="add-leg" onClick={addLeg}>＋新增</button>

        <HighchartsReact highcharts={Highcharts} options={chartOpt} />

        <div className="modal-footer">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
