// -----------------------------------------------------------
// server.js  
// -----------------------------------------------------------
const express  = require("express");
const fs       = require("fs");
const path     = require("path");
const { spawn } = require("child_process");

const app  = express();
const PORT = process.env.PORT || 3001;
const R    = p => path.join(__dirname, p);      // path helper

/* =========================================================
 * 1.  靜態檔 —— 放最前面沒關係
 * ======================================================= */
app.use(express.static(R("../frontend/build")));

/* =========================================================
 * 2.  JSON 解析
 * ======================================================= */
app.use(express.json());

/* =========================================================
 * 3.  API：Shioaji KEY / SECRET
 * ======================================================= */
app.post("/set-sj-key", (req, res) => {
  const { key, sec } = req.body || {};
  if (!key || !sec) return res.status(400).send("need key/sec");

  /* 寫入暫存檔 */
  fs.writeFileSync("/tmp/.env", `SJ_KEY=${key}\nSJ_SEC=${sec}\n`);

  /* 同步到目前行程環境，立刻可用 */
  process.env.SJ_KEY = key;
  process.env.SJ_SEC = sec;

  startPython();                     // 立刻啟動 / 熱重啟
  res.sendStatus(200);
});

/* 前端偵測用：Python 正跑 → 200；否則 503 */
app.get("/sj-ready", (_, res) => {
  if (pyProc) return res.sendStatus(200);
  return res.sendStatus(503);
});

/* Render 健康檢查 */
app.get("/healthz", (_, res) => res.send("ok"));

/* =========================================================
 * 4.  Socket.IO：把任何事件中繼出去
 * ======================================================= */
const http = require("http").createServer(app);
const io   = require("socket.io")(http, { cors: { origin: "*" } });

io.on("connection", socket => {
  console.log("socket connected:", socket.id);

  /* 轉送所有事件（排除自己） */
  socket.onAny((event, ...args) => {
    socket.broadcast.emit(event, ...args);
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected:", socket.id);
  });
});

/* =========================================================
 * 5.  啟動 / 熱重啟 Python
 * ======================================================= */
let pyProc = null;

function keysReady() {
  const envFile = "/tmp/.env";
  if (!fs.existsSync(envFile)) return false;
  const txt = fs.readFileSync(envFile, "utf-8");
  return txt.includes("SJ_KEY=") && txt.includes("SJ_SEC=");
}

function loadKeys(envObj) {
  const envFile = "/tmp/.env";
  if (!fs.existsSync(envFile)) return;
  fs.readFileSync(envFile, "utf-8")
    .trim()
    .split("\n")
    .forEach(line => {
      const [k, v] = line.split("=");
      if (k && v !== undefined) envObj[k] = v;
    });
}

function startPython() {
  if (pyProc) return;                 // 已在跑
  if (!keysReady()) {
    console.log("Python NOT started: SJ_KEY / SJ_SEC missing.");
    return;
  }

  const env = { ...process.env };
  loadKeys(env);

  const PY_PATH = R("../backend/shioaji_stream.py");
  pyProc = spawn("python", [PY_PATH], { env, stdio: "inherit" });

  pyProc.on("exit", code => {
    console.log(`python exit ${code}`);
    pyProc = null;                    // 方便下次再啟
  });
}

/* =========================================================
 * 6.  SPA fallback —— **最後一條路由** （非常重要）
 * ======================================================= */
app.get("*", (_, res) => {
  res.sendFile(R("../frontend/build/index.html"));
});

/* =========================================================
 * 7.  伺服器起跑
 * ======================================================= */
http.listen(PORT, () => {
  console.log(`Node server on ${PORT}`);
  if (keysReady()) startPython();     // 若已有 key 就自動啟
});
