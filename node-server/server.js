// -----------------------------------------------------------
// server.js  
// -----------------------------------------------------------
const express = require("express");
const fs      = require("fs");
const path    = require("path");
const { spawn } = require("child_process");

const app  = express();
const PORT = process.env.PORT || 3001;
const R    = p => path.join(__dirname, p);   // 路徑工具

/* ---------------------------------------------------------
 * 1.  靜態檔 ＆ SPA fallback
 * ------------------------------------------------------- */
app.use(express.static(R("../frontend/build")));
app.get("*", (_, res) => {
  res.sendFile(R("../frontend/build/index.html"));
});

/* ---------------------------------------------------------
 * 2.  API：收 Shioaji KEY / SECRET
 * ------------------------------------------------------- */
app.use(express.json());

app.post("/set-sj-key", (req, res) => {
  const { key, sec } = req.body || {};
  if (!key || !sec) return res.status(400).send("need key/sec");

  /* 暫存到 /tmp，供下一次熱重啟 Python 時讀取 */
  fs.writeFileSync("/tmp/.env", `SJ_KEY=${key}\nSJ_SEC=${sec}\n`);
  startPython();           // ⟵ 熱啟動 / 重啟
  res.sendStatus(200);
});

/* 前端探測用：Python 有連上就回 200，否則 503 */
app.get("/sj-ready", (_, res) => res.sendStatus(pyProc ? 200 : 503));

/* 健康檢查 (Render 使用) */
app.get("/healthz", (_, res) => res.send("ok"));

/* ---------------------------------------------------------
 * 3. Socket.IO
 *    - 任何 client (Python 或瀏覽器) 送進來的事件，
 *      直接 broadcast 給「除了自己之外」的其他所有 client
 * ------------------------------------------------------- */
const http = require("http").createServer(app);
const io   = require("socket.io")(http, { cors: { origin: "*" } });

io.on("connection", socket => {
  console.log("socket connected:", socket.id);

  /* 將收到的所有事件 → 廣播出去 (排除自己) */
  socket.onAny((event, ...args) => {
    socket.broadcast.emit(event, ...args);
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected:", socket.id);
  });
});

/* ---------------------------------------------------------
 * 4. 啟動 / 熱重啟 Python
 * ------------------------------------------------------- */
let pyProc = null;

function startPython() {
  if (pyProc) return;                // 已在跑就不重啟

  /* 讀取 /tmp/.env → 灌到環境變數，讓 Python 能拿到 KEY / SECRET */
  const env = { ...process.env };
  if (fs.existsSync("/tmp/.env")) {
    fs.readFileSync("/tmp/.env", "utf-8")
      .trim()
      .split("\n")
      .forEach(line => {
        const [k, v] = line.split("=");
        env[k] = v;
      });
  }

  const PY_PATH = R("../backend/shioaji_stream.py");
  pyProc = spawn("python", [PY_PATH], { env, stdio: "inherit" });

  pyProc.on("exit", code => {
    console.log(`python exit ${code}`);
    pyProc = null;                   // 方便下次再啟
  });
}

/* ---------------------------------------------------------
 * 5. 伺服器起跑
 * ------------------------------------------------------- */
http.listen(PORT, () => {
  console.log(`Node server on ${PORT}`);
  startPython();                     // 沒 Key 會立即退出 → 前端跳 modal
});
