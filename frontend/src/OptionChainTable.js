// -------------------------------------------------------------
// OptionChainTable.j
// -------------------------------------------------------------
import React, { useEffect, useRef, useState } from "react";
import OrderBookTable from "./OrderBookTable";
import "./OptionChainTable.css";

const clean = (o) =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")
  );

const dropUndef = (o) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const keyOf = (exp, strike, cp) => `${exp}_${strike}_${cp}`;

/* ---------- 週 / 月選代碼解析 ---------- */
function parseSymbolOrCode(str, defExp = null) {
  if (!str) return { strike: null, expiration: null, cp: null };

  /* 月選 (TXOyyyyMMddKCP) —— 15碼 */
  if (str.startsWith("TXO") && str.length >= 17) {
    const raw = str.slice(3, 11);
    return {
      strike: +str.slice(11, 16),
      expiration: `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`,
      cp: str.endsWith("C") ? "C" : "P",
    };
  }

  /* 週選 (TX1 / TX2 / TX4 / TX5) —— 10碼 */
  const m = str.match(/^TX[1245](\d{5})([A-Z])(\d)$/);
  if (m) {
    return {
      strike: +m[1],
      expiration: defExp || "NearMonth",
      cp: m[2] >= "A" && m[2] <= "L" ? "C" : "P",
    };
  }

  return { strike: null, expiration: null, cp: null };
}

const isCallITM = (k, f) => +f > 0 && k < f;
const isPutITM  = (k, f) => +f > 0 && k > f;

const normPdf = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);


function normCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const a1 = 0.319381530,
        a2 = -0.356563782,
        a3 = 1.781477937,
        a4 = -1.821255978,
        a5 = 1.330274429;
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const cdf  = 1 - normPdf(Math.abs(x)) * poly;
  return sign === 1 ? cdf : 1 - cdf;
}

function impliedVol({ S, K, T, r, price, isCall }) {
  if (price <= 0 || T <= 0) return null;
  let sigma = 0.25;                          
  const phi = isCall ? 1 : -1;
  for (let i = 0; i < 50; i++) {
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    const theo = phi * (S * normCdf(phi * d1) - K * Math.exp(-r * T) * normCdf(phi * d2));
    const vega = S * normPdf(d1) * Math.sqrt(T);
    const diff = theo - price;
    if (Math.abs(diff) < 1e-4) break;
    sigma = Math.max(1e-4, sigma - diff / vega);
  }
  return sigma;
}

function calcGreeks({ S, K, T, r, sigma, isCall }) {
  if (!sigma || T <= 0) return {};
  const phi = isCall ? 1 : -1;
  const d1  = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2  = d1 - sigma * Math.sqrt(T);

  const delta = phi * normCdf(phi * d1);
  const gamma = normPdf(d1) / (S * sigma * Math.sqrt(T));
  const vega  = S * normPdf(d1) * Math.sqrt(T) / 100;                        // 每 1% IV
  const theta = (-S * normPdf(d1) * sigma / (2 * Math.sqrt(T))
               - phi * r * K * Math.exp(-r * T) * normCdf(phi * d2)) / 365;  // 每日
  const rho   = phi * K * T * Math.exp(-r * T) * normCdf(phi * d2) / 100;

  return { delta, gamma, theta, vega, rho };
}
/* =========================================================
   MAIN COMPONENT
   =======================================================*/
export default function OptionChainTable({
  socket,
  currentFuturePrice,
  onSelOtmSumChange,
  onNearestOtmSumChange,
  onNearestExpiration,
}) {
  /* -------- state -------- */
  const [optMap, setOptMap]   = useState({});  // { key => option row }
  const [baMap,  setBaMap]    = useState({});  // { key => bid/ask row }
  const [flash,  setFlash]    = useState({});  // cell flash css
  const [expData, setExpData] = useState({
    expirations: [],
    defaultExpiration: null,
    strikesByExpiration: {},
    defaultSubsetByExpiration: {},
  });

  const [selExp,    setSelExp]    = useState(null);
  const showAll = true;
  const [selStrike, setSelStrike] = useState(null);
  const [initialized, setInitialized] = useState(false); 
  const [showGreeks, setShowGreeks]   = useState(false);

  const prevBA = useRef({});
  const nearestExp = expData.defaultExpiration;

  /* -------- 價外時間價值總和 -------- */
  useEffect(() => {
    if (!nearestExp || currentFuturePrice == null) return;
    let s = 0;
    Object.values(optMap).forEach((o) => {
      if (o.expiration !== nearestExp) return;
      const last = +o.last;
      if (isNaN(last)) return;
      if (
        (o.cp === "C" && o.strike > currentFuturePrice) ||
        (o.cp === "P" && o.strike < currentFuturePrice)
      )
        s += last;
    });
    onNearestOtmSumChange?.(s);
  }, [optMap, currentFuturePrice, nearestExp]);

  useEffect(() => {
    if (!selExp || currentFuturePrice == null) return;
    let s = 0;
    Object.values(optMap).forEach((o) => {
      if (o.expiration !== selExp) return;
      const last = +o.last;
      if (isNaN(last)) return;
      if (
        (o.cp === "C" && o.strike > currentFuturePrice) ||
        (o.cp === "P" && o.strike < currentFuturePrice)
      )
        s += last;
    });
    onSelOtmSumChange?.(s);
  }, [optMap, currentFuturePrice, selExp]);

  /* 最近到期日回給父層 */
  useEffect(() => {
    if (nearestExp) onNearestExpiration?.(nearestExp);
  }, [nearestExp]);

  useEffect(() => {
    const f = {};
    Object.keys(baMap).forEach((key) => {
      const n = baMap[key];
      const o = prevBA.current[key];
      if (!o) return;
      [
        "bid1",
        "ask1",
        "last",
        "bid2",
        "ask2",
        "bid3",
        "ask3",
        "bid4",
        "ask4",
        "bid5",
        "ask5",
      ].forEach((k) => {
        if (n[k] !== undefined && o[k] !== undefined && n[k] !== o[k]) {
          f[`${key}_${k}`] = {
            backgroundColor: +n[k] > +o[k] ? "rgba(255,0,0,0.3)" : "rgba(0,255,0,0.3)",
          };
          setTimeout(() =>
            setFlash((s) => {
              const t = { ...s };
              delete t[`${key}_${k}`];
              return t;
            }),
          800);
        }
      });
    });
    prevBA.current = baMap;
    setFlash((s) => ({ ...s, ...f }));
  }, [baMap]);

  /* ==================  只掛 dailySnap / expirationData ================= */
  useEffect(() => {
    if (!socket) return;

    /* ---- dailySnap ---- */
    const onDailySnap = ({ chainRows = [] }) => {
      const opt = {}, ba = {};
      chainRows.forEach((r) => {
        const cp = r.cp === "C" || r.cp === "Call" ? "C" : "P";
        const key = keyOf(r.expiration, r.strike, cp);
        opt[key] = {
          key, // save for easy access later
          strike: r.strike,
          cp,
          expiration: r.expiration,
          last: r.last ?? undefined,
          total_volume: r.volume ?? undefined,
          change_rate: r.chg ?? undefined,
          oi: r.oi ?? undefined,
        };
        ba[key] = { bid1: r.bid ?? undefined, ask1: r.ask ?? undefined };
      });
      setOptMap(opt);
      setBaMap(ba);
      setInitialized(true);
    };

    /* ---- expirationData ---- */
    const onExpData = (d) => {
      setExpData(d);
      setSelExp((e) => e ?? d.defaultExpiration);
    };

    socket.on("dailySnap", onDailySnap);
    socket.on("expirationData", onExpData);

    return () => {
      socket.off("dailySnap", onDailySnap);
      socket.off("expirationData", onExpData);
    };
  }, [socket]);

  /* ================== ② 初始化後才掛即時訂閱 ================= */
  useEffect(() => {
    if (!socket || !initialized) return;

    /* -------- Tick / Snapshot -------- */
    const onOption = (raw) => {
      const d0 = clean(raw);
      const key = keyOf(d0.expiration, d0.strike, d0.cp);

      const d = {
        key,
        strike: d0.strike,
        cp: d0.cp,
        expiration: d0.expiration,
        last: d0.last !== undefined ? +d0.last : undefined,
        change_rate: d0.change_rate !== undefined ? +d0.change_rate : undefined,
        total_volume: d0.total_volume !== undefined ? +d0.total_volume : undefined,
      };

      setOptMap((p) => ({ ...p, [key]: { ...p[key], ...d } }));

      const pricePatch = dropUndef(
        [1, 2, 3, 4, 5].reduce(
          (o, lv) => ({
            ...o,
            [`bid${lv}`]: d0[`bid${lv}`] !== undefined ? +d0[`bid${lv}`] : undefined,
            [`ask${lv}`]: d0[`ask${lv}`] !== undefined ? +d0[`ask${lv}`] : undefined,
          }),
          {}
        )
      );

      if (Object.keys(pricePatch).length)
        setBaMap((p) => ({ ...p, [key]: { ...(p[key] || {}), ...pricePatch } }));
    };

    /* -------- BidAsk (五檔) -------- */
    const onBidAsk = (raw) => {
      const withExp =
        raw.expiration !== undefined
          ? raw
          : { ...raw, ...parseSymbolOrCode(raw.symbol || raw.code, expData.defaultExpiration) };
      const d0 = clean(withExp);
      const key = keyOf(d0.expiration, d0.strike, d0.cp);

      const priceLv = [1, 2, 3, 4, 5].reduce(
        (o, l) => ({
          ...o,
          [`bid${l}`]: d0[`bid${l}`] !== undefined ? +d0[`bid${l}`] : undefined,
          [`ask${l}`]: d0[`ask${l}`] !== undefined ? +d0[`ask${l}`] : undefined,
        }),
        {}
      );

      const baUpd = dropUndef({
        key,
        strike: d0.strike,
        cp: d0.cp,
        expiration: d0.expiration,
        ...priceLv,
        bid_volume: Array.isArray(d0.bid_volume) ? d0.bid_volume.map((v) => +v) : undefined,
        ask_volume: Array.isArray(d0.ask_volume) ? d0.ask_volume.map((v) => +v) : undefined,
      });

      setBaMap((p) => ({ ...p, [key]: { ...(p[key] || {}), ...baUpd } }));
      // 確保 optMap 至少有殼
      setOptMap((p) => ({
        ...p,
        [key]: { ...(p[key] || {}), key, strike: d0.strike, cp: d0.cp, expiration: d0.expiration },
      }));
    };

    socket.on("optionData", onOption);
    socket.on("bidAskData", onBidAsk);

    return () => {
      socket.off("optionData", onOption);
      socket.off("bidAskData", onBidAsk);
    };
  }, [socket, initialized, expData.defaultExpiration]);

  /* ---------------- Strike list ---------------- */
  const strikes = selExp
    ? (() => {
        const base = expData.strikesByExpiration[selExp] || [];
        const extra = Object.values(optMap)
          .filter((o) => o.expiration === selExp)
          .map((o) => o.strike);
        return Array.from(new Set([...base, ...extra])).sort((a, b) => a - b);
      })()
    : [];

  /* ---------------- 其他 max 值 ---------------- */
  const maxC = Math.max(
    1,
    ...Object.values(optMap)
      .filter((o) => o.expiration === selExp && o.cp === "C")
      .map((o) => o.total_volume || 0)
  );
  const maxP = Math.max(
    1,
    ...Object.values(optMap)
      .filter((o) => o.expiration === selExp && o.cp === "P")
      .map((o) => o.total_volume || 0)
  );
  const maxFiveVol = Math.max(
    1,
    ...Object.values(baMap).flatMap((ba) => [...(ba.bid_volume || []), ...(ba.ask_volume || [])])
  );

  /* ---------------- Build rows ---------------- */
  const fmt = (v, p = 4) =>
    v === undefined || v === null || isNaN(v) ? "-" : (+v).toFixed(p);

  const rows = strikes.flatMap((k) => {
    /* === 找對應 CP === */
    const find = (cp) =>
      Object.values(optMap).find((o) => o.expiration === selExp && o.strike === k && o.cp === cp);
    const C = find("C"),
      P = find("P");
    const CBA = C ? baMap[C.key] || {} : {};
    const PBA = P ? baMap[P.key] || {} : {};

    /* === ITM / OTM class === */
    const cCls = isCallITM(k, currentFuturePrice) ? "itm" : "otm";
    const pCls = isPutITM(k, currentFuturePrice) ? "itm" : "otm";

    if (showGreeks) {
      const S = currentFuturePrice;
      // 把 "YYYY/MM/DD" 轉 Date，預設到期日台灣下午 13:30 收盤
      const T = (() => {
        if (!selExp) return 0.0001;
        const [y, m, d] = selExp.split("/").map((x) => +x);
        const expDate = new Date(y, m - 1, d, 13, 30, 0);
        return Math.max(0.0001, (expDate.getTime() - Date.now()) / (365 * 24 * 3600 * 1000));
      })();
      const r = 0.01745; // 1.745%

      const sigmaC = impliedVol({
        S,
        K: k,
        T,
        r,
        price: +C?.last || 0,
        isCall: true,
      });
      const sigmaP = impliedVol({
        S,
        K: k,
        T,
        r,
        price: +P?.last || 0,
        isCall: false,
      });

      const gC = calcGreeks({ S, K: k, T, r, sigma: sigmaC, isCall: true });
      const gP = calcGreeks({ S, K: k, T, r, sigma: sigmaP, isCall: false });

      return (
        <tr key={`g-${k}`} onClick={() => setSelStrike((s) => (s === k ? null : k))}>
          {/* Call Greeks */}
          <td className={`cell-call ${cCls}`}>{fmt(gC.delta)}</td>
          <td className={`cell-call ${cCls}`}>{fmt(gC.gamma)}</td>
          <td className={`cell-call ${cCls}`}>{fmt(gC.theta)}</td>
          <td className={`cell-call ${cCls}`}>{fmt(gC.vega)}</td>
          <td className={`cell-call ${cCls}`}>{fmt(gC.rho)}</td>

          {/* Strike */}
          <td className="strike-cell">{k}</td>

          {/* Put Greeks */}
          <td className={`cell-put ${pCls}`}>{fmt(gP.delta)}</td>
          <td className={`cell-put ${pCls}`}>{fmt(gP.gamma)}</td>
          <td className={`cell-put ${pCls}`}>{fmt(gP.theta)}</td>
          <td className={`cell-put ${pCls}`}>{fmt(gP.vega)}</td>
          <td className={`cell-put ${pCls}`}>{fmt(gP.rho)}</td>
        </tr>
      );
    }

    /* =========================================================
       ↓↓↓ 原本價格 + 五檔顯示邏輯（完全保留） ↓↓↓
       =========================================================*/
    const pct = (v) => {
      if (v === undefined || v === "-" || v === "") return "-";
      const n = +v;
      if (isNaN(n)) return "-";
      return <span style={{ color: n > 0 ? "red" : n < 0 ? "green" : "#fff" }}>{`${n}%`}</span>;
    };
    const val = (o, f, d = "-") => (o && o[f] !== undefined ? o[f] : d);

    /* -------- 基本行 -------- */
    const base = (
      <tr key={k} onClick={() => setSelStrike((s) => (s === k ? null : k))}>
        {/* Call volume bar */}
        <td className={`cell-call ${cCls} volume-bar`}>
          <div className="volume-bar-container-call">
            <div
              className="volume-bar-call"
              style={{ width: `${((+C?.total_volume || 0) / maxC) * 100}%` }}
            />
          </div>
        </td>
        <td className={`cell-call ${cCls} volume-number`}>{+C?.total_volume || 0}</td>
        <td className={`cell-call ${cCls}`}>{pct(C?.change_rate)}</td>
        <td className={`cell-call ${cCls}`} style={flash[`${C?.key}_last`]}>
          {val(C, "last")}
        </td>
        <td className={`cell-call ${cCls}`} style={flash[`${C?.key}_bid1`]}>
          {val(CBA, "bid1")}
        </td>
        <td className={`cell-call ${cCls}`} style={flash[`${C?.key}_ask1`]}>
          {val(CBA, "ask1")}
        </td>

        {/* Strike */}
        <td className="strike-cell">{k}</td>

        {/* Put area */}
        <td className={`cell-put ${pCls}`} style={flash[`${P?.key}_bid1`]}>
          {val(PBA, "bid1")}
        </td>
        <td className={`cell-put ${pCls}`} style={flash[`${P?.key}_ask1`]}>
          {val(PBA, "ask1")}
        </td>
        <td className={`cell-put ${pCls}`} style={flash[`${P?.key}_last`]}>
          {val(P, "last")}
        </td>
        <td className={`cell-put ${pCls}`}>{pct(P?.change_rate)}</td>
        <td className={`cell-put ${pCls} volume-number`}>{+P?.total_volume || 0}</td>
        <td className={`cell-put ${pCls} volume-bar`}>
          <div className="volume-bar-container-put">
            <div
              className="volume-bar-put"
              style={{ width: `${((+P?.total_volume || 0) / maxP) * 100}%` }}
            />
          </div>
        </td>
      </tr>
    );

    if (selStrike !== k) return base;

    /* -------- 五檔明細 -------- */
    const mk = (ba, side, lv) =>
      lv
        .map((i) => {
          const price = +ba[`${side}${i}`] || null;
          const vols  = ba[`${side}_volume`] || [];
          const vol   = +(vols[i - 1] || 0);
          return [price, vol];
        })
        .filter(([p, v]) => p || v);

    const bidsC = mk(CBA, "bid", [1, 2, 3, 4, 5]);
    const asksC = mk(CBA, "ask", [1, 2, 3, 4, 5]);
    const bidsP = mk(PBA, "bid", [1, 2, 3, 4, 5]);
    const asksP = mk(PBA, "ask", [1, 2, 3, 4, 5]);

    return [
      base,
      <tr key={`${k}-detail`} className="detail-row">
        <td colSpan="13">
          <div className="detail-row-container">
            <OrderBookTable
              bids={bidsC}
              asks={asksC}
              maxVolume={maxFiveVol}
              title={`Call ${k}`}
            />
            <OrderBookTable
              bids={bidsP}
              asks={asksP}
              maxVolume={maxFiveVol}
              title={`Put  ${k}`}
            />
          </div>
        </td>
      </tr>,
    ];
  });

  /* ---------------- Render ---------------- */
  return (
    <div className="option-chain-container">
      <div className="top-bar">
        <div>
          <label>到期日：</label>
          <select
            value={selExp || ""}
            onChange={(e) => {
              setSelExp(e.target.value);
              setSelStrike(null);
            }}
          >
            {expData.expirations.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>

        {/* ★★★ 切換希臘字母按鈕 (新增) ★★★ */}
        <button
          className="toggle-btn"
          onClick={() => setShowGreeks((s) => !s)}
          style={{ marginLeft: 8 }}
        >
          {showGreeks ? "回到價格表" : "切換希臘字母"}
        </button>
      </div>

      <table className="option-table">
        {showGreeks ? (
          /* ------ 希臘字母表頭 ------ */
          <thead>
            <tr>
              <th colSpan="5" className="call-header">
                CALL
              </th>
              <th rowSpan="2" className="strike-header">
                履約價
              </th>
              <th colSpan="5" className="put-header">
                PUT
              </th>
            </tr>
            <tr>
              <th>Δ</th>
              <th>Γ</th>
              <th>Θ</th>
              <th>Vega</th>
              <th>ρ</th>
              <th>Δ</th>
              <th>Γ</th>
              <th>Θ</th>
              <th>Vega</th>
              <th>ρ</th>
            </tr>
          </thead>
        ) : (
          /* ------ 原價量表頭（不變） ------ */
          <thead>
            <tr>
              <th colSpan="6" className="call-header">
                CALL
              </th>
              <th rowSpan="2" className="strike-header">
                履約價
              </th>
              <th colSpan="6" className="put-header">
                PUT
              </th>
            </tr>
            <tr>
              <th>     </th>
              <th>成交量</th>
              <th>漲跌</th>
              <th>成交價</th>
              <th>買價</th>
              <th>賣價</th>
              <th>買價</th>
              <th>賣價</th>
              <th>成交價</th>
              <th>漲跌</th>
              <th>成交量</th>
              <th>     </th>
            </tr>
          </thead>
        )}

        <tbody>
          {rows.length ? (
            rows
          ) : (
            <tr>
              <td colSpan={showGreeks ? 11 : 13} style={{ color: "#999" }}>
                {selExp ? "尚未取得資料" : "尚未選擇到期日"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
