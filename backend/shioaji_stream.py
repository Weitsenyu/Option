# -*- coding: utf-8 -*-
import os, re, time, bisect, threading, warnings, sys, io
from datetime import datetime, date, timedelta
from collections import defaultdict

import pandas as pd
import requests
import socketio
import shioaji as sj
from shioaji.constant import QuoteType, QuoteVersion
from shioaji import Exchange, TickFOPv1, BidAskFOPv1

# === 0. 使用者參數 & 環境檢查 ==============================
SOCKET_HUB = os.getenv("SOCKET_HUB", "http://localhost:3001")
API_KEY    = os.getenv("SJ_KEY")
API_SECRET = os.getenv("SJ_SEC")
URL_DAY    = "https://www.taifex.com.tw/cht/3/optDailyMarketExcel"
URL_NIGHT  = URL_DAY + "?marketCode=1"
HEADERS    = {"User-Agent": "Mozilla/5.0"}

if not (API_KEY and API_SECRET):
    print("❗ 尚未設定 Shioaji KEY/SECRET，請先 POST /set-sj-key")
    sys.exit(0)

warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")

# === 1. HTML 解析小工具 ===================================
def _best_encoding(res):
    ct = res.headers.get("content-type", "").lower()
    return "utf-8" if "utf-8" in ct else "big5"

def fetch_table(url: str, is_night: bool):
    """
    向臺交所下載日盤或夜盤的 HTML，回傳一張
    包含「履約價」欄位的 DataFrame 以及交易日字串。
    """
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.encoding = _best_encoding(r)
    text = r.text.replace("&nbsp;", " ")

    # 擷取交易日
    if not is_night:
        m = re.search(r"日期：\s*([\d/]+)", text)
    else:
        m = re.search(r"(\d{4}/\d{2}/\d{2})\s*\d{2}:\d{2}\s*[~～]\s*次日", text)
    if not m:
        raise RuntimeError("無法從網頁擷取到交易日，請檢查網頁格式")
    date_str = m.group(1)

    # 讀所有表，挑出有「履約價」的那一張
    dfs = pd.read_html(io.StringIO(text), header=0, flavor="lxml")
    df  = next(tbl for tbl in dfs if "履約價" in tbl.columns)
    # 清理
    df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
    if df.iloc[-1, 0] in ("合計", "總計"):
        df = df.iloc[:-1]
    df.replace({"-": pd.NA, "－": pd.NA}, inplace=True)

    # 把「日盤/夜盤」跟交易日加進去（如果需要紀錄）
    df["市場時段"] = "夜盤" if is_night else "日盤"
    df["交易日"]   = pd.to_datetime(date_str, format="%Y/%m/%d")

    return df, date_str

# === 2. 資料結構轉換小工具 ================================
CLEAN_COL = re.compile(r"[\s＊*()（）]").sub
norm      = lambda s: CLEAN_COL("", str(s))
NUM       = re.compile(r"[^0-9+\-.]").sub
to_int    = lambda x: int(float(NUM("", str(x)))) if pd.notna(x) and str(x).strip() else 0
to_float  = lambda x: float(NUM("", str(x)))      if pd.notna(x) and str(x).strip() else None
strike    = lambda code: int(code[3:8]) if len(code)>=9 and code[3:8].isdigit() else None

def pick(df, *keys, raise_err=True):
    """在 df.columns 中，找包含所有關鍵字的那一個欄位名稱。"""
    if keys and isinstance(keys[-1], bool):
        raise_err, keys = keys[-1], keys[:-1]
    keys = tuple(str(k) for k in keys)
    for c in df.columns:
        if all(k in norm(c) for k in keys):
            return c
    if raise_err:
        raise KeyError("/".join(keys))
    return None

def expiry_to_date(exp: str):
    """把像 '202506W4' 之類的文字，轉成真正到期日 YYYY/MM/DD。"""
    y, m = int(exp[:4]), int(exp[4:6])
    n    = int(exp[-1]) if "W" in exp else 3
    cnt, d = 0, 1
    while True:
        if date(y, m, d).weekday() == 2:  # 星期三
            cnt += 1
            if cnt == n:
                return date(y, m, d).strftime("%Y/%m/%d")
        d += 1

def parse_chain(df, is_day: bool):
    """把那張表拆成 list of dict，格式跟原本一樣。"""
    mcol = pick(df, "到期月份")
    kcol = pick(df, "履約價")
    ccol = pick(df, "買賣權")
    # volume / netPos
    vol_c = pick(df, "合計成交量", False) if is_day else pick(df, "成交量", False)
    net_c = pick(df, "MktPos", False) or pick(df, "NetMktPos", False) or pick(df, "rev.NetMktPos", False)
    vol_c = vol_c or pick(df, "成交量")
    bid_c = pick(df, "最後最佳買價")
    ask_c = pick(df, "最後最佳賣價")
    last_c= pick(df, "最後", "成交價")
    chg_c = pick(df, "漲跌%")
    oi_c  = pick(df, "未沖銷")

    rows = []
    for _, r in df.iterrows():
        if pd.isna(r[kcol]) or r[ccol] not in ("Call", "Put"):
            continue
        # 到期日
        try:
            exp_real = expiry_to_date(str(r[mcol]).strip())
        except:
            exp_real = str(r[mcol]).strip()
        rows.append({
            "expiration": exp_real,
            "strike": float(r[kcol]),
            "cp": "C" if r[ccol] == "Call" else "P",
            "volume": to_int(r[vol_c]),
            "bid": to_float(r[bid_c]),
            "ask": to_float(r[ask_c]),
            "last": to_float(r[last_c]),
            "chg": to_float(r[chg_c]),
            "oi": to_int(r[oi_c]),
            "netPos": to_int(r[net_c]) if net_c else 0
        })
    return rows

def merge(day, nite):
    """把日夜盤資料依 (expiration,strike,cp) 合併在一起。"""
    key = lambda r: (r["expiration"], r["strike"], r["cp"])
    d = {}
    for r in day + nite:
        d.setdefault(key(r), {}).update({k:v for k,v in r.items() if v not in (None,0)})
    return list(d.values())

# === 3. 立即抓取第一次快照 & 推送 dailySnap ================
# 先抓取日盤 & 夜盤
df_day, day_str = fetch_table(URL_DAY,   False)
df_nig, nig_str = fetch_table(URL_NIGHT, True)
day_rows  = parse_chain(df_day, True)
nite_rows = parse_chain(df_nig, False)
chain_rows = merge(day_rows, nite_rows)

# Socket.IO 客戶端
sio = socketio.Client(logger=False)
sio.connect(SOCKET_HUB)
sio.emit("dailySnap", {"chainRows": chain_rows}, namespace="/")
print(f"📤 dailySnap (日:{len(day_rows)} 夜:{len(nite_rows)})")

def safe_emit(evt, data):
    if sio.connected:
        sio.emit(evt, data)
    else:
        threading.Timer(0.3, lambda: safe_emit(evt, data)).start()

# === 4. Shioaji 登入 & 推送期貨Kbars ========================
api = sj.Shioaji()
api.login(API_KEY, API_SECRET, contracts_timeout=10000)
print("✅ Shioaji login / contracts ready")

fut = api.Contracts.Futures.TXF.TXFR1
mxf = api.Contracts.Futures["MX4R1"]
tse = api.Contracts.Indexs.TSE["001"]

def emit_kbars():
    end   = datetime.now().date()
    start = end - timedelta(days=30)
    kbars = api.kbars(contract=fut,
                      start=start.strftime("%Y-%m-%d"),
                      end  =end.strftime("%Y-%m-%d"))
    df = pd.DataFrame({**kbars})
    df.ts = pd.to_datetime(df.ts)
    daily = (
        df.set_index("ts")
          .resample("1D", offset="9h")
          .agg({"Open":"first","High":"max","Low":"min","Close":"last","Volume":"sum"})
          .dropna().tail(30)
          .reset_index()
    )
    daily = daily.drop_duplicates(subset="ts").sort_values("ts")
    daily["ts"] = (daily["ts"].view("int64") // 1_000_000).astype(int)
    safe_emit("futKbars", {"kbars": daily.to_dict("records")})
    print(f"📤 futKbars ({len(daily)}) bars")

emit_kbars()

# === 5. 準備選擇權合約索引 & Expirations/Subsets ==============
options = list(api.Contracts.Options.TXO)
for sec in ("TX1","TX2","TX4","TX5"):
    if hasattr(api.Contracts.Options, sec):
        options += list(getattr(api.Contracts.Options, sec))

code2exp   = {c.code: c.delivery_date for c in options}
exp2strikes= defaultdict(list)
for c in options:
    k = strike(c.code); e = code2exp[c.code]
    if k: exp2strikes[e].append(k)
for v in exp2strikes.values(): v.sort()

valid_exp   = sorted(exp2strikes, key=lambda d: datetime.strptime(d,"%Y/%m/%d"))
nearest_exp = valid_exp[0]

def cp_of(code): return "C" if code[8].upper()<="L" else "P"
def subset(px, exp):
    ks = exp2strikes.get(exp, [])
    if not ks or px is None: return []
    i = bisect.bisect_right(ks, px)
    call = ks[i:i+15]; put = ks[max(0,i-25):i]
    call += ks[i+15:i+15+(15-len(call))]
    put  = ks[max(0,i-25-(25-len(put))):max(0,i-25)] + put
    return sorted(set(call+put))

def emit_exp_data(px):
    sio.emit("expirationData", {
      "expirations": valid_exp,
      "defaultExpiration": nearest_exp,
      "strikesByExpiration": {e:list(v) for e,v in exp2strikes.items()},
      "defaultSubsetByExpiration": {e:subset(px,e) for e in valid_exp}
    }, namespace="/")

# === 6. 市場狀態 & 推送函式 ================================
def emit_price(p):   sio.emit("priceUpdate",{"ts":int(time.time()*1000),"price":p},namespace="/")
mkt_state = defaultdict(lambda:{"bid":None,"ask":None,"last":None})
_last_sent= {}

def emit_mkt():
    data = {k:dict(v) for k,v in mkt_state.items()}
    if "TSE" in data:
        data["TSE"].pop("bid",None); data["TSE"].pop("ask",None)
    global _last_sent
    if data!=_last_sent:
        _last_sent=data
        sio.emit("marketInfo", data, namespace="/")

# 初次 Snapshot & expirationData
cur_px = float(api.snapshots([fut])[0].close)
emit_exp_data(cur_px)
def init_snap():
    snaps=api.snapshots([fut,mxf,tse],timeout=5000)
    for s in snaps:
        tag = "TXF" if s.code.startswith("TXF") else "MXF" if s.code.startswith(("MXF","MX4")) else "TSE"
        if tag!="MXF":
            mkt_state[tag]["last"] = float(s.close)
    emit_mkt(); emit_price(cur_px)

init_snap()

# === 7. 自動訂閱 & 回呼 ===================================
subscribed = set()
def ensure_sub():
    global cur_px
    idx = {strike(c.code):c for c in options if code2exp[c.code]==nearest_exp}
    ks  = sorted(idx)
    if not ks: return
    i   = bisect.bisect_right(ks, cur_px)
    targ= set(ks[i:i+15] + ks[max(0,i-25):i])
    added=False
    for k in targ:
        for cp in ("C","P"):
            c = idx.get((k if cp=="C" else k),None)
            if c and c.code not in subscribed:
                for qt in (QuoteType.Tick,QuoteType.BidAsk):
                    api.quote.subscribe(c, qt, version=QuoteVersion.v1)
                subscribed.add(c.code)
                added=True
    if added: emit_exp_data(cur_px)

for c in (fut,mxf,tse):
    for qt in (QuoteType.Tick,QuoteType.BidAsk):
        api.quote.subscribe(c, qt, version=QuoteVersion.v1)

@api.on_tick_fop_v1()
def on_tick(_:Exchange, t:TickFOPv1):
    tag = ("TXF" if t.code.startswith("TXF")
           else "MXF" if t.code.startswith(("MXF","MX4"))
           else None)
    if tag:
        price=float(t.close); mkt_state[tag]["last"]=price
        if tag=="TXF": emit_price(price)
        emit_mkt(); return
    if t.code not in code2exp: return
    sio.emit("optionData", {
      "code":t.code, "strike":strike(t.code),
      "expiration":code2exp[t.code], "cp":cp_of(t.code),
      "last":float(t.close),"change_rate":float(getattr(t,"change_rate",0)),
      "total_volume":int(getattr(t,"total_volume",0))
    }, namespace="/")

@api.on_bidask_fop_v1()
def on_ba(_:Exchange, ba:BidAskFOPv1):
    tag = ("TXF" if ba.code.startswith("TXF")
           else "MXF" if ba.code.startswith(("MXF","MX4"))
           else None)
    if tag:
        bid=float(ba.bid_price[0] or 0); ask=float(ba.ask_price[0] or 0)
        if bid: mkt_state[tag]["bid"]=bid
        if ask: mkt_state[tag]["ask"]=ask
        if tag=="TXF":
            emit_mkt(); return
        if tag=="MXF":
            if bid and ask: mkt_state[tag]["last"]=int(round((bid+ask)/2))
            elif bid or ask: mkt_state[tag]["last"]=int(bid or ask)
            emit_mkt(); return
    if ba.code not in code2exp: return
    getp=lambda arr,i:float(arr[i]) if arr and len(arr)>i and arr[i] else None
    sio.emit("bidAskData", {
      "code":ba.code,"strike":strike(ba.code),
      "expiration":code2exp[ba.code],"cp":cp_of(ba.code),
      **{f"bid{i+1}":getp(ba.bid_price,i) for i in range(5)},
      **{f"ask{i+1}":getp(ba.ask_price,i) for i in range(5)},
      "bid_volume":[int(v) for v in (ba.bid_volume or [])],
      "ask_volume":[int(v) for v in (ba.ask_volume or [])]
    }, namespace="/")

# === 8. 周期快照 Loop & 訂閱維護 ===========================
def snap_loop():
    while True:
        try:
            snaps=api.snapshots([fut,mxf,tse],timeout=5000)
            for s in snaps:
                tag = ("TXF" if s.code.startswith("TXF")
                       else "MXF" if s.code.startswith(("MXF","MX4"))
                       else "TSE")
                if tag!="MXF":
                    mkt_state[tag]["last"]=float(s.close)
            emit_mkt()
        except: pass

        batch=[c for c in options if c.code in subscribed]
        for i in range(0,len(batch),500):
            try:
                snaps=api.snapshots(batch[i:i+500], timeout=10000)
            except Exception as e:
                print("snapshot error:", e); continue
            for s in snaps:
                exp=code2exp.get(s.code, nearest_exp)
                sio.emit("optionData", {
                  "code":s.code,"strike":strike(s.code),
                  "expiration":exp,"cp":cp_of(s.code),
                  "last":float(getattr(s,"close",0)),
                  "change_rate":float(getattr(s,"change_rate",0)),
                  "total_volume":int(getattr(s,"total_volume",0))
                }, namespace="/")
                sio.emit("bidAskData", {
                  "code":s.code,"strike":strike(s.code),
                  "expiration":exp,"cp":cp_of(s.code),
                  "bid1":float(getattr(s,"buy_price",0)),
                  "ask1":float(getattr(s,"sell_price",0))
                }, namespace="/")
            time.sleep(0.2)
        time.sleep(1)

threading.Thread(target=snap_loop, daemon=True).start()

try:
    while True:
        ensure_sub()
        time.sleep(1)
except KeyboardInterrupt:
    sio.disconnect()
    api.logout()
