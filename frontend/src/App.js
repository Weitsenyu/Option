// -----------------------------------------------------------
// App.js  (rev-final + key-input modal)
// -----------------------------------------------------------
import React, { useEffect, useMemo, useState } from "react";
import io from "socket.io-client";

import FuturesBarChart         from "./FuturesBarChart";
import OtmSumChart             from "./OtmSumChart";
import OptionChainTable        from "./OptionChainTable";
import OIHistogram             from "./OIHistogram";
import IVSmileChart            from "./IVSmileChart";
import ProfitDistributionChart from "./ProfitDistributionChart";
import PositionSimulatorModal  from "./PositionSimulatorModal";
import "./App.css";

/* ========= Key-Input Modal ========= */
function KeyInputModal({ open, onSubmit }) {
  const [key, setKey] = useState("");
  const [sec, setSec] = useState("");
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="key-modal">
        <h3>輸入 Shioaji API Key</h3>
        <input
          placeholder="API_KEY"
          value={key}
          onChange={e => setKey(e.target.value)}
        />
        <input
          placeholder="API_SECRET"
          value={sec}
          onChange={e => setSec(e.target.value)}
          style={{ marginTop: 8 }}
        />
        <button disabled={!key || !sec} onClick={() => onSubmit({ key, sec })}>
          送出
        </button>
      </div>
    </div>
  );
}

/* ======== 時間工具 ======== */
const fmtSec = s =>
  s <= 0
    ? "結算中"
    : `${String(Math.floor(s / 86400)).padStart(2, "0")}天` +
      `${String(Math.floor((s % 86400) / 3600)).padStart(2, "0")}時` +
      `${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}分` +
      `${String(Math.floor(s % 60)).padStart(2, "0")}秒`;

const fmtMin = m => {
  const d = Math.floor(m / 1440),
    h = Math.floor((m % 1440) / 60),
    mm = m % 60;
  return `${String(d).padStart(2, "0")}天${String(h).padStart(
    2,
    "0"
  )}時${String(mm).padStart(2, "0")}分`;
};

const leftSecs = exp =>
  Math.max(
    0,
    new Date(`${exp.replace(/\//g, "-")}T13:30:00+08:00`) - Date.now()
  ) / 1000;

/* 目前 → 結算可交易分鐘 */
const tradableMinutesUntil = exp => {
  if (!exp) return 0;
  let cur = new Date(),
    sum = 0;
  const end = new Date(`${exp.replace(/\//g, "-")}T13:30:00+08:00`);
  while (cur < end) {
    const y = cur.getFullYear(),
      m = cur.getMonth(),
      d = cur.getDate(),
      wd = cur.getDay();
    if (wd === 0) {
      cur = new Date(y, m, d + 1, 8, 45);
      continue;
    }
    if (wd === 6 && cur >= new Date(y, m, d, 5)) {
      cur = new Date(y, m, d + 2, 8, 45);
      continue;
    }
    [
      [new Date(y, m, d, 8, 45), new Date(y, m, d, 13, 45)],
      [new Date(y, m, d, 15, 0), new Date(y, m, d + 1, 5, 0)]
    ].forEach(([a, b]) => {
      if (cur >= b || a >= end) return;
      const from = cur > a ? cur : a,
        to = b > end ? end : b;
      if (from < to) sum += (to - from) / 60000;
    });
    cur = new Date(y, m, d + 1, 8, 45);
  }
  return Math.floor(sum);
};

/* ========== 主元件 ========== */
export default function App() {
  /* ---- state ---- */
  const [socket, setSocket] = useState(null);
  const [rows, setRows] = useState([]);
  const [futPx, setFutPx] = useState(null);
  const [futK, setFutK] = useState([]);

  const [avg, setAvg] = useState({ name: "過去四週平均", data: [] });
  const [rt, setRt] = useState([]);
  const [mkt, setMkt] = useState({});

  const [nearExp, setNearExp] = useState("");
  const [otmVal, setOtmVal] = useState(0);

  const [oiExp, setOiExp] = useState("");
  const [ivExp, setIvExp] = useState("");
  const [profitExp, setProfitExp] = useState("");

  const [time, setTime] = useState({ cal: "-", trade: "-" });
  const [showSim, setShowSim] = useState(false);

  const [needKey, setNeedKey] = useState(true);      // <-- 是否要先輸入 key

  /* ---- 啟動前探測 python 是否已經在跑 ---- */
  useEffect(() => {
    fetch("/sj-ready")
      .then(r => {
        if (r.ok) setNeedKey(false);
      })
      .catch(() => {});
  }, []);

  /* ---- socket ---- */
  useEffect(() => {
    const ENDPOINT =
      window.location.hostname === "localhost"
        ? "http://localhost:3001"
        : undefined;
    const s = io(ENDPOINT);
    setSocket(s);
    return () => s.disconnect();
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket
      .on("dailySnap", ({ chainRows }) => setRows(chainRows || []))
      .on("priceUpdate", ({ price }) => !isNaN(+price) && setFutPx(+price))
      .on("marketInfo", info => setMkt(info))
      .on("otmSeries", ({ average }) => setAvg(average))
      .on("newData", ({ value }) => setRt(v => [...v, value]))
      .on("futKbars", ({ kbars }) => setFutK(kbars));
    return () => socket.removeAllListeners();
  }, [socket]);

  const expirations = useMemo(
    () => [...new Set(rows.map(r => r.expiration))].sort(),
    [rows]
  );

  useEffect(() => {
    if (!expirations.length) return;
    setOiExp(e => e || expirations[0]);
    setIvExp(e => e || expirations[0]);
    setProfitExp(e => e || expirations[0]);
  }, [expirations]);

  useEffect(() => {
    if (!nearExp) return;
    const id = setInterval(
      () =>
        setTime({
          cal: fmtSec(leftSecs(nearExp)),
          trade: fmtMin(tradableMinutesUntil(nearExp))
        }),
      1000
    );
    return () => clearInterval(id);
  }, [nearExp]);

  const realtimeSeries = useMemo(
    () => ({
      name: "本週即時",
      data: rt.map((v, i) => [
        tradableMinutesUntil(nearExp) - i,
        +(+v).toFixed(2)
      ])
    }),
    [rt, nearExp]
  );

  const currentPoint = useMemo(
    () => [tradableMinutesUntil(nearExp), otmVal],
    [nearExp, otmVal]
  );

  /* ---- 小組件 ---- */
  const InfoCard = ({ title, data }) => {
    const [hover, setHover] = useState(false);
    return (
      <div
        className="info-card"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={`${title}：即時成交；滑鼠停留可看買賣價`}
      >
        <div className="info-title">{title}</div>
        <div className="price-main">{data.last ?? "-"}</div>
        {hover && (
          <div className="price-detail">
            買 {data.bid ?? "-"} | 賣 {data.ask ?? "-"}
          </div>
        )}
      </div>
    );
  };

  const Simple = ({ label, value, tip }) => (
    <div className="simple-block" title={tip || label}>
      <div className="info-title">{label}</div>
      <div className="price-main simple">{value}</div>
    </div>
  );

  /* ---- render ---- */
  return (
    <>
      <div className="page-container">
        {/* Top Bar */}
        <div className="top-bar">
          <span className="page-title">期權 Dashboard</span>
          <button className="sim-btn-top" onClick={() => setShowSim(true)}>
            策略模擬
          </button>
        </div>

        {/* Left */}
        <div className="left-panel">
          <div className="left-scroll">
            <h2 className="panel-title">TXF 近月 30 日 K 線</h2>
            <div className="fut-chart-wrap">
              <FuturesBarChart kbars={futK} lastPrice={futPx} />
            </div>

            <h2 className="panel-title">
              本週即時 vs 四週平均（剩餘可交易分鐘）
            </h2>
            <OtmSumChart
              average={avg}
              realtime={realtimeSeries}
              currentPoint={currentPoint}
            />

            <div className="chart-section">
              <h2 className="panel-title">OI 直方圖</h2>
              <div className="chart-header">
                <label className="dropdown-label">OI 到期日：</label>
                <select value={oiExp} onChange={e => setOiExp(e.target.value)}>
                  {expirations.map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <OIHistogram data={rows} exp={oiExp} />
            </div>

            <div className="chart-section">
              <h2 className="panel-title">IV Smile 曲線</h2>
              <div className="chart-header">
                <label className="dropdown-label">IV 到期日：</label>
                <select value={ivExp} onChange={e => setIvExp(e.target.value)}>
                  {expirations.map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <IVSmileChart chainRows={rows} exp={ivExp} futPrice={futPx} />
            </div>

            <div className="chart-section">
              <h2 className="panel-title">到期損益分佈</h2>
              <div className="chart-header">
                <label className="dropdown-label">損益到期日：</label>
                <select
                  value={profitExp}
                  onChange={e => setProfitExp(e.target.value)}
                >
                  {expirations.map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <ProfitDistributionChart rows={rows} exp={profitExp} />
            </div>
          </div>
        </div>

        {/* Center */}
        <div className="center-panel">
          <Simple
            label="剩餘時間"
            value={time.cal}
            tip="距最近結算的日曆時間"
          />
          <Simple
            label="剩餘交易時間"
            value={time.trade}
            tip="扣除非交易時段後的有效分鐘"
          />
          <InfoCard title="TXF 近月" data={mkt.TXF || {}} />
          <InfoCard title="MXF 近週" data={mkt.MXF || {}} />
          <Simple label="加權指數" value={mkt.TSE?.last ?? "-"} />
          <Simple
            label="OTM 時間價值"
            value={Number.isFinite(otmVal) ? otmVal.toFixed(0) : "-"}
          />
        </div>

        {/* Right */}
        <div className="right-panel">
          <h2 className="panel-title">選擇權鏈</h2>
          <OptionChainTable
            socket={socket}
            currentFuturePrice={futPx}
            onNearestExpiration={setNearExp}
            onNearestOtmSumChange={setOtmVal}
          />
        </div>

        {/* Position Simulator */}
        <PositionSimulatorModal
          show={showSim}
          onClose={() => setShowSim(false)}
          futPrice={futPx}
          expirations={expirations}
          rows={rows}
        />
      </div>

      {/* Key-input modal */}
      <KeyInputModal
        open={needKey}
        onSubmit={({ key, sec }) => {
          fetch("/set-sj-key", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, sec })
          }).then(r => {
            if (r.ok) {
              setNeedKey(false);
            } else {
              alert("後端回傳錯誤，請再試一次");
            }
          });
        }}
      />
    </>
  );
}
