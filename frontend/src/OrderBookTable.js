// -------------------------------------------------------------
// OrderBookTable.js 
// -------------------------------------------------------------
import React from "react";
import "./OrderBookTable.css";

export default function OrderBookTable({ bids = [], asks = [], maxVolume = 1, title }) {
  const fmt = n => (n === undefined || n === null ? "-" : n);

  const mkRow = i => {
    const [bp, bq] = bids[i] || [];
    const [ap, aq] = asks[i] || [];
    return (
      <tr key={i}>
        <td className="vol buy"  style={{ backgroundSize:`${(bq/maxVolume)*100}% 100%` }}>{fmt(bq)}</td>
        <td className="price">{fmt(bp)}</td>
        <td className="price">{fmt(ap)}</td>
        <td className="vol sell" style={{ backgroundSize:`${(aq/maxVolume)*100}% 100%` }}>{fmt(aq)}</td>
      </tr>
    );
  };

  return (
    <div className="ob-panel">
      <h4>{title}</h4>
      <table className="ob-table">
        <thead>
          <tr><th colSpan="2">買</th><th colSpan="2">賣</th></tr>
          <tr><th>量</th><th>價</th><th>價</th><th>量</th></tr>
        </thead>
        <tbody>{[0,1,2,3,4].map(mkRow)}</tbody>
      </table>
    </div>
  );
}
