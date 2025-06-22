// -----------------------------------------------------------
// server.js  (final fixed – 延遲啟動 Python + Socket 轉發)
// -----------------------------------------------------------
const express = require("express");
const fs      = require("fs");
const path    = require("path");
const { spawn } = require("child_process");

const app  = express();
const PORT = process.env.PORT || 3001;
const R    = p => path.join(__dirname, p);          // path helper

/* =========================================================
 * 1.  靜態檔 + SPA fallback
 * ======================================================= */
app.use(express.static(R("../frontend/build")));
app.get("*", (_, res) => {
  res.sendFile(R("../frontend/build/index.html"));
});

/* =========================================================
 * 2.  API：收 Shioaji KEY / SECRET
 * ======================================================= */
app.use(express.json());

app.post("/set-sj-key", (req, res) => {
  const { key, sec } = req.body || {};
  if (!key || !sec) {
    return res.status(400).send("need key/sec");
  }

  /* 寫到 /tmp/.env，讓下一次重啟或立即啟動都找得到 */
  fs.writeFileSync("/tmp/.env", `SJ_KEY=${key}\nSJ_SEC=${sec}\n`);

  /* 同步到目前的 process.env（讓立刻啟動時讀得到） */
  process.env.SJ_KEY = key;
  process.env.SJ_SEC = sec;

  startPython();                       // ← 立刻啟動
  res.sendStatus(200);
});

/* 前端探測是否就緒：Python 正在跑才能拿到 200 */
app.get("/sj-ready", (_, res) => {
  if (pyProc) return res.sendStatus(200);
  return res.sendStatus(503);
});

/* 健康檢查 (Render) */
app.get("/healthz", (_, res) => res.send("ok"));

/* =========================================================
 * 3.  Socket.IO：把任意事件做 relay
 * ======================================================= */
const http = require("http").createServer(app);
const io   = require("socket.io")(http, { cors: { origin: "*" } });

io.on("connection", socket => {
  console.log("socket connected:", socket.id);

  /* 任何事件都 broadcast 給其它 client（不含自己） */
  socket.onAny((event, ...args) => {
    socket.broadcast.emit(event, ...args);
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected:", socket.id);
  });
});

/* =========================================================
 * 4.  啟動 / 熱重啟 Python
 * ======================================================= */
let pyProc = null;

/* 檢查 /tmp/.env 是否已經擁有 KEY/SEC */
function keysReady() {
  const envFile = "/tmp/.env";
  if (!fs.existsSync(envFile)) return false;
  const txt = fs.readFileSync(envFile, "utf-8").trim();
  return txt.includes("SJ_KEY=") && txt.includes("SJ_SEC=");
}

function loadKeysIntoEnv(envObj) {
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
  /* 沒有 KEY → 不啟動 */
  if (pyProc) return;
  if (!keysReady()) {
    console.log("Python NOT started: SJ_KEY / SJ_SEC missing.");
    return;
  }

  const env = { ...process.env };
  loadKeysIntoEnv(env);

  const PY_PATH = R("../backend/shioaji_stream.py");
  pyProc = spawn("python", [PY_PATH], { env, stdio: "inherit" });

  pyProc.on("exit", code => {
    console.log(`python exit ${code}`);
    pyProc = null;                    // 讓下一次可重新啟
  });
}

/* =========================================================
 * 5.  伺服器起跑
 *      └─ 僅在「已經有 KEY」時自動啟動 Python
 * ======================================================= */
http.listen(PORT, () => {
  console.log(`Node server on ${PORT}`);
  if (keysReady()) startPython();     // 首次部署通常沒有 KEY → 不啟
});
