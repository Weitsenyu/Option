/* ---------------------------------------------------------
   server.js  (rev-final)
--------------------------------------------------------- */
const express = require("express");
const fs      = require("fs");
const path    = require("path");
const { spawn } = require("child_process");

const app  = express();
const PORT = process.env.PORT || 3001;
const R    = p => path.join(__dirname, p);   // resolve helper

/* --------- 靜態檔 + SPA fallback --------- */
app.use(express.static(R("../frontend/build")));
app.get("*", (req, res) => {
  res.sendFile(R("../frontend/build/index.html"));
});

/* --------- 接收 SJ Key --------- */
app.use(express.json());

app.post("/set-sj-key", (req, res) => {
  const { key, sec } = req.body || {};
  if (!key || !sec) return res.status(400).send("need key/sec");
  fs.writeFileSync("/tmp/.env", `SJ_KEY=${key}\nSJ_SEC=${sec}\n`);
  startPython();
  res.sendStatus(200);
});

/* 是否已啟動 python？ */
app.get("/sj-ready", (_, res) => res.sendStatus(pyProc ? 200 : 503));

/* 健康檢查 */
app.get("/healthz", (_, res) => res.send("ok"));

/* --------- Socket.IO（空殼，照你原邏輯補 emit） --------- */
const http = require("http").createServer(app);
const io   = require("socket.io")(http, { cors: { origin: "*" } });
// 這裡把你原本 broadcast 的事件綁上去即可…

/* --------- 啟動 / 重啟 Python --------- */
let pyProc = null;
function startPython() {
  if (pyProc) return;                     // 已在跑就不重複

  const env = { ...process.env };
  if (fs.existsSync("/tmp/.env")) {
    fs.readFileSync("/tmp/.env", "utf-8")
      .split("\n")
      .filter(Boolean)
      .forEach(l => {
        const [k, v] = l.split("=");
        env[k] = v;
      });
  }

  const PY = R("../backend/shioaji_stream.py");
  pyProc = spawn("python", [PY], { env, stdio: "inherit" });

  pyProc.on("exit", code => {
    console.log(`python exit ${code}`);
    pyProc = null;                        // 允許下次重新啟動
  });
}

/* --------- 伺服器啟動 --------- */
http.listen(PORT, () => {
  console.log(`Node server on ${PORT}`);
  startPython();                          // 若沒 key 會立即退出
});
