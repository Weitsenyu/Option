# Options Trading Dashboard

A comprehensive real-time options trading dashboard built with React.js, Node.js, and Shioaji API. It visualizes market data, options chains, Greeks, and interactive charts for enhanced trading decisions.

---

# 選擇權交易儀表板

這是一個基於 React.js、Node.js 和 Shioaji API 開發的即時選擇權交易儀表板，具備市場數據視覺化、選擇權鏈、希臘值計算與互動式圖表，協助交易者做出更佳決策。

---

## Features / 功能特色

### Real-time Market Data / 即時市場數據

* **Description / 說明：**
  Real-time updates on futures prices, option prices, and bid-ask spreads.
  提供期貨價格、選擇權價格、五檔報價即時更新。

### Interactive Options Chain / 互動式選擇權鏈

* **Description / 說明：**
  Interactive table displaying strikes, call and put options, implied volatility, Greeks, and real-time price changes.
  互動式表格顯示履約價、Call 與 Put 選擇權、隱含波動率、希臘值與即時價格變化。

### Greeks Calculation / 希臘值計算

* **Description / 說明：**
  Automatic calculation of Delta, Gamma, Theta, Vega, and Rho for each option.
  自動計算每個選擇權的 Delta、Gamma、Theta、Vega 與 Rho。

### Advanced Visualization / 高級視覺化

* **Description / 說明：**
  Advanced charts including OI Histogram, IV Smile, Profit Distribution, and OTM Sum.
  提供高級圖表如 OI 直方圖、IV Smile 曲線、損益分布、OTM 時間價值總和等。

### Futures K-Bar Chart / 期貨 K 線圖

* **Description / 說明：**
  Real-time candlestick charts of TXF futures to analyze market trends.
  提供即時 TXF 期貨 K 線圖，協助分析市場趨勢。

### Strategy Simulator / 策略模擬器

* **Description / 說明：**
  Allows simulation and visualization of various trading strategies.
  提供策略模擬功能，幫助交易者視覺化不同交易策略的結果。


## Usage / 使用說明

### Initial API Key Setup / 初始 API 金鑰設定

The API key and secret for Shioaji will be requested at initial setup or in special circumstances provided directly by the developer.
首次設定或特殊情況下將由開發者直接提供 Shioaji API 的 key 與 secret。

### Accessing the Dashboard / 存取儀表板

Open your browser and go to:

```bash
https://tsenyu-option.onrender.com
```

---

## Project Structure / 專案結構

```
my-options-website/
├── backend/
│   ├── shioaji_stream.py
│   ├── 時間價值.xlsx
│   ├── requirements.txt
│   └── shioaji.log
├── frontend/
│   ├── src/
│   │   ├── App.js
│   │   ├── OptionChainTable.js
│   │   ├── OrderBookTable.js
│   │   ├── OtmSumChart.js
│   │   ├── OIHistogram.js
│   │   ├── IVSmileChart.js
│   │   ├── FuturesBarChart.js
│   │   ├── ProfitDistributionChart.js
│   │   ├── PositionSimulatorModal.js
│   │   └── index.js
│   ├── package.json
│   └── package-lock.json
└── node-server/
    ├── server.js
    ├── package.json
    └── package-lock.json
```

---

## Deployment / 部署

This project can be deployed on platforms like Render, Heroku, or AWS.
可在 Render、Heroku 或 AWS 等平台部署。

Example Render deployment:

* Create a Web Service on Render pointing to your GitHub repository.
* Set environment variables:

  * `SJ_KEY`: Shioaji API key
  * `SJ_SEC`: Shioaji API secret

Render 專案範例連結：
[Render Deployment](https://tsenyu-option.onrender.com)

---

## Contributions & License / 貢獻與授權

Feel free to fork the repository and submit pull requests. Open issues on GitHub for any problems or suggestions.
歡迎 Fork 此專案並提交 Pull Request，有任何問題或建議請於 GitHub 上開啟 issue。

This project is licensed under the MIT License.
本專案採用 MIT 授權條款。

---

## Contact / 聯絡方式

For questions or feedback, please contact [Weitsenyu](mailto:tsenyuwork@gmail.com).
如有疑問或回饋，請聯絡 [Weitsenyu](mailto:tsenyuwork@gmail.com)。
