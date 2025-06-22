// -----------------------------------------------------------
// App.js  (final – 含「API-Key 輸入」Modal)
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
    <div className="login-wrapper">        
      <form
        className="login-card"               
        onSubmit={e => {
          e.preventDefault();
          onSubmit({ key, sec });
        }}
      >
        <h1>Shioaji<br />API 登入</h1>      
        <label>API_KEY</label>           
        <input
          placeholder="API_KEY"
          value={key}
          onChange={e => setKey(e.target.value.trim())}
        />
        <label>API_SECRET</label>
        <input
          placeholder="API_SECRET"
          value={sec}
          onChange={e => setSec(e.target.value.trim())}
          style={{ marginTop: 4 }}
        />
        <button type="submit" disabled={!key || !sec}>
          連　線
        </button>
      </form>
    </div>
  );
}


/* ========= 時間工具 ========= */
const fmtSec = seconds => {
  const s = Math.floor(seconds);
  if (s <= 0) return "結算中";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (
    `${String(d).padStart(2, "0")}天` +
    `${String(h).padStart(2, "0")}時` +
    `${String(m).padStart(2, "0")}分` +
    `${String(sec).padStart(2, "0")}秒`
  );
};

const fmtMin = minutes => {
  const m = Math.floor(minutes);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return (
    `${String(d).padStart(2, "0")}天` +
    `${String(h).padStart(2, "0")}時` +
    `${String(mm).padStart(2, "0")}分`
  );
};

const leftSecs = exp =>
  Math.max(
    0,
    new Date(`${exp.replace(/\//g, "-")}T13:30:00+08:00`) - Date.now()
  ) / 1000;

/* 計算「現在 → 結算」剩餘可交易分鐘（含日盤＋夜盤） */
const tradableMinutesUntil = exp => {
  if (!exp) return 0;
  let cur = new Date();
  let sum = 0;
  const end = new Date(`${exp.replace(/\//g, "-")}T13:30:00+08:00`);

  while (cur < end) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const d = cur.getDate();
    const wd = cur.getDay();

    /* 星期日：直接跳到星期一 08:45 */
    if (wd === 0) {
      cur = new Date(y, m, d + 1, 8, 45);
      continue;
    }
    /* 星期六 05:00 之後：跳到下週一 08:45 */
    if (wd === 6 && cur >= new Date(y, m, d, 5)) {
      cur = new Date(y, m, d + 2, 8, 45);
      continue;
    }

    /* 日盤 & 夜盤可交易區段 */
    const segments = [
      [new Date(y, m, d, 8, 45), new Date(y, m, d, 13, 45)],  // 日盤
      [new Date(y, m, d, 15, 0), new Date(y, m, d + 1, 5, 0)] // 夜盤
    ];

    segments.forEach(([a, b]) => {
      if (cur >= b || a >= end) return;
      const from = cur > a ? cur : a;
      const to   = b  > end ? end : b;
      if (from < to) sum += (to - from) / 60000;
    });

    /* 移到下一天 08:45 再繼續 */
    cur = new Date(y, m, d + 1, 8, 45);
  }
  return Math.floor(sum);
};

/* ========= 主元件 ========= */
export default function App() {
  /* ---------- State ---------- */
  const [socket, setSocket] = useState(null);
  const [rows,   setRows]   = useState([]);
  const [futPx,  setFutPx]  = useState(null);
  const [futK,   setFutK]   = useState([]);

  const [avg, setAvg] = useState({ name: "過去四週平均", data: [] });
  const [rt , setRt ] = useState([]);
  const [mkt, setMkt] = useState({});

  const [nearExp, setNearExp] = useState("");
  const [otmVal , setOtmVal ] = useState(0);

  const [oiExp    , setOiExp    ] = useState("");
  const [ivExp    , setIvExp    ] = useState("");
  const [profitExp, setProfitExp] = useState("");

  const [time   , setTime   ] = useState({ cal: "-", trade: "-" });
  const [showSim, setShowSim] = useState(false);

  const [needKeyModal, setNeedKeyModal] = useState(true);   // 初次開啟要不要 Key

  /* ---------- 檢查後端是否已啟動 ---------- */
  useEffect(() => {
    fetch("/sj-ready")
      .then(r => {
        if (r.ok) setNeedKeyModal(false);
      })
      .catch(() => {});
  }, []);

  /* ---------- socket.io 連線 ---------- */
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
      .on("dailySnap" , ({ chainRows }) => setRows(chainRows || []))
      .on("priceUpdate", ({ price })    => !isNaN(+price) && setFutPx(+price))
      .on("marketInfo",  info           => setMkt(info))
      .on("otmSeries",   ({ average })  => setAvg(average))
      .on("newData",     ({ value })    => setRt(v => [...v, value]))
      .on("futKbars",    ({ kbars })    => setFutK(kbars));
    return () => socket.removeAllListeners();
  }, [socket]);

  /* ---------- 衍生資料 ---------- */
  const expirations = useMemo(
    () => [...new Set(rows.map(r => r.expiration))].sort(),
    [rows]
  );

  useEffect(() => {
    if (!expirations.length) return;
    setOiExp    (e => e || expirations[0]);
    setIvExp    (e => e || expirations[0]);
    setProfitExp(e => e || expirations[0]);
  }, [expirations]);

  /* 倒數計時 */
  useEffect(() => {
    if (!nearExp) return;
    const id = setInterval(() => {
      setTime({
        cal  : fmtSec(leftSecs(nearExp)),
        trade: fmtMin(tradableMinutesUntil(nearExp))
      });
    }, 1000);
    return () => clearInterval(id);
  }, [nearExp]);

  /* 本週即時 OTM 曲線 */
  const realtimeSeries = useMemo(() => ({
    name: "本週即時",
    data: rt.map((v, i) => [
      tradableMinutesUntil(nearExp) - i,
      +(+v).toFixed(2)
    ])
  }), [rt, nearExp]);

  const currentPoint = useMemo(
    () => [tradableMinutesUntil(nearExp), otmVal],
    [nearExp, otmVal]
  );

  /* ---------- Reusable 小卡 ---------- */
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

  /* ---------- 畫面 ---------- */
  return (
    <>
      {/* ======== 主畫面 ======== */}
      <div className="page-container">
        {/* --- Top Bar --- */}
        <div className="top-bar">
          <span className="page-title">期權 Dashboard</span>
          <button className="sim-btn-top" onClick={() => setShowSim(true)}>
            策略模擬
          </button>
        </div>

        {/* --- Left Panel --- */}
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

            {/* OI Histogram */}
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

            {/* IV Smile */}
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

            {/* Profit Distribution */}
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

        {/* --- Center Panel --- */}
        <div className="center-panel">
          <Simple
            label="剩餘時間"
            value={time.cal}
            tip="距離最近結算日的日曆時間"
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
            value={
              Number.isFinite(otmVal) ? otmVal.toFixed(0) : "-"
            }
          />
        </div>

        {/* --- Right Panel --- */}
        <div className="right-panel">
          <h2 className="panel-title">選擇權鏈</h2>
          <OptionChainTable
            socket={socket}
            currentFuturePrice={futPx}
            onNearestExpiration={setNearExp}
            onNearestOtmSumChange={setOtmVal}
          />
        </div>

        {/* --- Position Simulator Modal --- */}
        <PositionSimulatorModal
          show={showSim}
          onClose={() => setShowSim(false)}
          futPrice={futPx}
          expirations={expirations}
          rows={rows}
        />
      </div>

      {/* ======== Key-Input Modal ======== */}
      <KeyInputModal
        open={needKeyModal}
        onSubmit={({ key, sec }) => {
          fetch("/set-sj-key", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, sec })
          })
            .then(r => {
              if (r.ok) {
                setNeedKeyModal(false);
              } else {
                alert("後端回傳錯誤，請確認 Key / Secret");
              }
            })
            .catch(() => alert("網路錯誤，請稍後再試"));
        }}
      />
    </>
  );
}
