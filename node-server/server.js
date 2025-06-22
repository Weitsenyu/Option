const express = require("express");
const fs       = require("fs");
const path     = require("path");
const { spawn }= require("child_process");

const app      = express();
const PORT     = process.env.PORT || 3001;

/* ========== 讓前端 build 檔可被直接下載 ========== */
app.use(express.static(path.join(__dirname, "../frontend/build")));
app.get("*", (req, res) => {
  // 除了 API 以外的 GET 都回前端 index.html
  res.sendFile(path.join(__dirname, "../frontend/build/index.html"));
});

/* ---------- 收 Shioaji Key ---------- */
app.use(express.json());

app.post("/set-sj-key", (req, res) => {
  const { key, sec } = req.body || {};
  if (!key || !sec) return res.status(400).send("need key/sec");
  fs.writeFileSync("/tmp/.env", `SJ_KEY=${key}\nSJ_SEC=${sec}\n`);
  startPython();
  res.sendStatus(200);
});

/* ---------- 健康檢查 ---------- */
app.get("/healthz", (_, res) => res.send("ok"));

/* ---------- Socket.IO 依你原本程式碼繼續 ---------- */
const http = require("http").createServer(app);
const io   = require("socket.io")(http, { cors: { origin: "*" } });
// TODO: 這裡塞你 broadcast 的 on / emit 事件 …

/* ---------- 啟動 / 重啟 Python ---------- */
let pyProc = null;
function startPython() {
  if (pyProc) return;                    // 已在跑就不重複
  const env = { ...process.env };

  // 把 /tmp/.env 內容灌進環境變數
  if (fs.existsSync("/tmp/.env")) {
    fs.readFileSync("/tmp/.env", "utf-8")
      .split("\n")
      .filter(Boolean)
      .forEach(line => {
        const [k, v] = line.split("=");
        env[k] = v;
      });
  }

  /* ！！這一行路徑要修成「相對於 node-server 的上一層」！！ */
  pyProc = spawn("python", ["../backend/shioaji_stream.py"], {
    env,
    stdio: "inherit",
  });

  pyProc.on("exit", code => {
    console.log(`python exit ${code}`);
    pyProc = null;               // 讓下一次 /set-sj-key 可以再啟
  });
}

/* ---------- 伺服器啟動 ---------- */
http.listen(PORT, () => {
  console.log(`Node server on ${PORT}`);
  startPython();   // 嘗試啟動（若沒 key 會自己退出）
});
