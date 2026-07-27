// ======================================
// NiftySenseAI Pro v1.0
// Live Data + Confirmation AI Engine
// NIFTY 50 + SENSEX
// ======================================

const SYMBOLS = {
  SENSEX: {
    yahooCode: "%5EBSESN",
    tvSymbol: "BSE:SENSEX",
    label: "SENSEX"
  },
  NIFTY: {
    yahooCode: "%5ENSEI",
tvSymbol: "NSE:NIFTY",
    label: "NIFTY 50"
  }
};

let currentSymbol = "SENSEX";
let candleHistory = [];
let lastGoodCandles = [];
let lastGoodPrice = null;
let predictionHistory = [];
let lastAlertedDecision = null;
let refreshTimer = null;
let isLoading = false;

// ---------- DOM Elements ----------
const els = {
  livePrice: document.getElementById("livePrice"),
  priceChange: document.getElementById("priceChange"),
  symbolLabel: document.getElementById("symbolLabel"),
  marketStatus: document.getElementById("marketStatus"),
  lastUpdated: document.getElementById("lastUpdated"),
  predictionTime: document.getElementById("predictionTime"),
  trend: document.getElementById("trend"),
  confidence: document.getElementById("confidence"),
  entry: document.getElementById("entry"),
  target1: document.getElementById("target1"),
  target2: document.getElementById("target2"),
  stoploss: document.getElementById("stoploss"),
  buyBtn: document.getElementById("buyBtn"),
  sellBtn: document.getElementById("sellBtn"),
  waitMessage: document.getElementById("waitMessage"),
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  errorText: document.getElementById("errorText"),
  retryBtn: document.getElementById("retryBtn"),
  marketClosedMessage: document.getElementById("marketClosedMessage"),
  tvChart: document.getElementById("tvChart"),
  tvFallback: document.getElementById("tvFallback"),
  tvRetryBtn: document.getElementById("tvRetryBtn"),
  predictionHistory: document.getElementById("predictionHistory"),
  aiReason: document.getElementById("aiReason"),
  vwap: document.getElementById("vwap"),
  adx: document.getElementById("adx"),
  trendStrength: document.getElementById("trendStrength"),
  support: document.getElementById("support"),
  resistance: document.getElementById("resistance"),
  candlePattern: document.getElementById("candlePattern"),
  riskLevel: document.getElementById("riskLevel"),
  riskReward: document.getElementById("riskReward")
};

// ---------- Helpers ----------
function setText(el, value) {
  if (el) el.textContent = value;
}

function setOptionalText(el, value) {
  if (el) el.textContent = value;
}

function fmt(num) {
  if (num == null || isNaN(num)) return "--";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function getApiUrl() {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${SYMBOLS[currentSymbol].yahooCode}?range=5d&interval=15m`;
}

// ---------- Indicators ----------
function ema(values, period) {
  if (values.length < period) return values.map(() => null);
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function lastVal(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

function calcRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function calcMACDHistogram(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes
    .map((_, i) => (ema12[i] != null && ema26[i] != null) ? ema12[i] - ema26[i] : null)
    .filter(v => v != null);
  if (macdLine.length < 9) return 0;
  const signal = ema(macdLine, 9);
  const macd = macdLine[macdLine.length - 1];
  const sig = signal[signal.length - 1];
  return sig == null ? 0 : macd - sig;
}

function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcVWAP(candles) {
  if (!candles.length) return null;
  const lastDate = new Date(candles[candles.length - 1].t * 1000)
    .toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const session = candles.filter(c =>
    new Date(c.t * 1000).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === lastDate
  );
  let cumPV = 0, cumV = 0;
  session.forEach(c => {
    const typical = (c.h + c.l + c.c) / 3;
    cumPV += typical * c.v;
    cumV += c.v;
  });
  return cumV ? cumPV / cumV : candles[candles.length - 1].c;
}

function findSupportResistance(candles, window = 3, lookback = 60) {
  const recent = candles.slice(-lookback);
  if (recent.length < window * 2 + 1) return { support: null, resistance: null };
  const price = recent[recent.length - 1].c;
  const supports = [], resistances = [];
  for (let i = window; i < recent.length - window; i++) {
    const slice = recent.slice(i - window, i + window + 1);
    if (recent[i].l === Math.min(...slice.map(s => s.l))) supports.push(recent[i].l);
    if (recent[i].h === Math.max(...slice.map(s => s.h))) resistances.push(recent[i].h);
  }
  const support = supports.filter(s => s < price).sort((a, b) => b - a)[0] ?? null;
  const resistance = resistances.filter(r => r > price).sort((a, b) => a - b)[0] ?? null;
  return { support, resistance };
}

function calcADX(highs, lows, closes, period = 14) {
  if (closes.length < period * 2) return null;
  const plusDM = [], minusDM = [], trs = [];
  for (let i = 1; i < closes.length; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  function wilder(arr, p) {
    const s = [];
    let sum = arr.slice(0, p).reduce((a, b) => a + b, 0);
    s[p - 1] = sum;
    for (let i = p; i < arr.length; i++) {
      sum = s[i - 1] - s[i - 1] / p + arr[i];
      s[i] = sum;
    }
    return s;
  }
  const sTR = wilder(trs, period);
  const sPlus = wilder(plusDM, period);
  const sMinus = wilder(minusDM, period);
  const dxArr = [];
  for (let i = period - 1; i < sTR.length; i++) {
    if (!sTR[i]) continue;
    const plusDI = 100 * (sPlus[i] / sTR[i]);
    const minusDI = 100 * (sMinus[i] / sTR[i]);
    const dx = (plusDI + minusDI) === 0 ? 0 : 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI);
    dxArr.push(dx);
  }
  if (!dxArr.length) return null;
  if (dxArr.length < period) return dxArr[dxArr.length - 1];
  let adx = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i]) / period;
  }
  return adx;
}

function detectCandlePattern(candles) {
  if (candles.length < 2) return { name: "None", bias: 0 };
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  const body = Math.abs(curr.c - curr.o);
  const range = (curr.h - curr.l) || 0.0001;
  const upper = curr.h - Math.max(curr.o, curr.c);
  const lower = Math.min(curr.o, curr.c) - curr.l;

  if (body / range < 0.1) return { name: "Doji", bias: 0 };
  if (lower > body * 2 && upper < body * 0.5 && curr.c > curr.o) return { name: "Hammer", bias: 1 };
  if (prev.c < prev.o && curr.c > curr.o && curr.c > prev.o && curr.o < prev.c) return { name: "Bullish Engulfing", bias: 1 };
  if (prev.c > prev.o && curr.c < curr.o && curr.o > prev.c && curr.c < prev.o) return { name: "Bearish Engulfing", bias: -1 };
  return { name: "None", bias: 0 };
}

function calcVolumeRatio(candles) {
  const vols = candles.map(c => c.v);
  if (vols.length < 10) return 1;
  const recent = vols.slice(-5);
  const older = vols.slice(-20, -5).length ? vols.slice(-20, -5) : recent;
  const rAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const oAvg = older.reduce((a, b) => a + b, 0) / older.length;
  return oAvg ? rAvg / oAvg : 1;
}

// ---------- Market Status ----------
const MARKET_HOLIDAYS_2026 = [
  "2026-01-15","2026-01-26","2026-03-03","2026-03-26","2026-03-31",
  "2026-04-03","2026-04-14","2026-05-01","2026-05-28","2026-06-26",
  "2026-09-14","2026-10-02","2026-10-20","2026-11-10","2026-11-24",
  "2026-12-25"
];

function isMarketOpen() {
  const now = new Date();
  const istStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istStr);
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (MARKET_HOLIDAYS_2026.includes(dateStr)) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= (9 * 60 + 15) && mins <= (15 * 60 + 30);
}

// ---------- Decision Engine ----------
function computeSignal(candles) {
  const closes = candles.map(c => c.c);
  const highs = candles.map(c => c.h);
  const lows = candles.map(c => c.l);
  const price = closes[closes.length - 1];

  const ema9 = lastVal(ema(closes, 9));
  const ema21 = lastVal(ema(closes, 21));
  const rsi = lastVal(calcRSI(closes, 14));
  const hist = calcMACDHistogram(closes);
  const atr = calcATR(highs, lows, closes, 14);
  const vwap = calcVWAP(candles);
  const adx = calcADX(highs, lows, closes, 14);
  const volRatio = calcVolumeRatio(candles);
  const { support, resistance } = findSupportResistance(candles);
  const pattern = detectCandlePattern(candles);

 let buyScore = 0;
let sellScore = 0;

if (ema9 != null && ema21 != null) {
  if (ema9 > ema21) buyScore += 25;
  else sellScore += 25;
}

if (rsi != null) {
  if (rsi >= 55 && rsi <= 70) buyScore += 20;
  else if (rsi <= 45) sellScore += 20;
}

if (hist > 0) buyScore += 25;
else sellScore += 25;

if (vwap != null) {
  if (price > vwap) buyScore += 20;
  else sellScore += 20;
}

if (pattern.bias === 1) buyScore += 10;
else if (pattern.bias === -1) sellScore += 10;

let decision = "WAIT";

if (adx != null && adx >= 30) {
  if (buyScore >= 80) decision = "BUY";
  else if (sellScore >= 80) decision = "SELL";
}

  const buffer = (atr || price * 0.002) * 0.5;
  if (decision === "BUY" && resistance != null && (resistance - price) < buffer) decision = "WAIT";
  if (decision === "SELL" && support != null && (price - support) < buffer) decision = "WAIT";
  if (decision === "BUY" && pattern.bias === -1) decision = "WAIT";
  if (decision === "SELL" && pattern.bias === 1) decision = "WAIT";

  const bullish = decision === "BUY";
  const atrVal = atr || price * 0.003;
  const entryLow = Math.round(price - atrVal * 0.1);
  const entryHigh = Math.round(price + atrVal * 0.1);
  const t1 = Math.round(bullish ? price + atrVal * 1.5 : price - atrVal * 1.5);
  const t2 = Math.round(bullish ? price + atrVal * 2.5 : price - atrVal * 2.5);
  const sl = Math.round(bullish ? price - atrVal * 1.0 : price + atrVal * 1.0);

  const risk = Math.abs(price - sl);
  const reward = Math.abs(t1 - price);
  const rr = risk === 0 ? "N/A" : `1:${(reward / risk).toFixed(1)}`;

  const atrPct = (atrVal / price) * 100;
  let riskLevel = "Unknown";
  if (atrPct < 0.15) riskLevel = "Low";
  else if (atrPct < 0.35) riskLevel = "Medium";
  else riskLevel = "High";

  let strength = "Unknown";
  if (adx != null) {
    if (adx < 20) strength = "Weak";
    else if (adx < 40) strength = "Moderate";
    else strength = "Strong";
  }

const conf =
  decision === "BUY"
    ? Math.min(99, buyScore + Math.max(0, (adx || 0) - 20) / 2)
    : decision === "SELL"
    ? Math.min(99, sellScore + Math.max(0, (adx || 0) - 20) / 2)
    : Math.min(49, 20 + ((adx || 0) / 3));

  const reasons = [];
  reasons.push(ema9 != null && ema21 != null ? (ema9 > ema21 ? "EMA Bullish" : "EMA Bearish") : "EMA N/A");
  reasons.push(rsi != null ? `RSI ${rsi.toFixed(0)}` : "RSI N/A");
  reasons.push(hist > 0 ? "MACD Positive" : "MACD Negative");
  reasons.push(vwap != null ? (price > vwap ? "Above VWAP" : "Below VWAP") : "VWAP N/A");
  reasons.push(volRatio > 1.1 ? "Volume High" : "Volume Normal");
  if (pattern.name !== "None") reasons.push(`Candle: ${pattern.name}`);

  return {
    decision,
    bullish,
    wait: decision === "WAIT",
confidence: Math.round(conf),
    entryLow, entryHigh,
    target1: t1, target2: t2, stoploss: sl,
    riskReward: rr,
    riskLevel,
    strength,
    reasons: reasons.join(" • "),
    vwap, adx, support, resistance,
pattern: pattern.name,
price,
predictionTime: Date.now()
};
}

// ---------- UI Update ----------
function updateUI(signal) {

  setText(els.trend, signal.wait ? "🟡 WAIT" : (signal.bullish ? "🟢 BULLISH" : "🔴 BEARISH"));
  setText(els.confidence, Math.round(signal.confidence) + "%");

setText(els.entry, `${fmt(signal.entryLow)} - ${fmt(signal.entryHigh)}`);
setText(els.target1, fmt(signal.target1));
setText(els.target2, fmt(signal.target2));
setText(els.stoploss, fmt(signal.stoploss));

  setOptionalText(els.aiReason, signal.reasons);
  setOptionalText(els.vwap, signal.vwap ? fmt(Math.round(signal.vwap)) : "--");
  setOptionalText(els.adx, signal.adx != null ? signal.adx.toFixed(1) : "--");
  setOptionalText(els.trendStrength, signal.strength);
  setOptionalText(els.support, signal.support ? fmt(Math.round(signal.support)) : "--");
  setOptionalText(els.resistance, signal.resistance ? fmt(Math.round(signal.resistance)) : "Not Found");
  setOptionalText(els.candlePattern, signal.pattern);
  setOptionalText(els.riskLevel, signal.riskLevel);
  setOptionalText(els.riskReward, signal.riskReward);

  if (signal.wait) {
    els.buyBtn.style.display = "none";
    els.sellBtn.style.display = "none";
    els.waitMessage.style.display = "block";
  } else if (signal.bullish) {
    els.buyBtn.style.display = "block";
    els.sellBtn.style.display = "none";
    els.waitMessage.style.display = "none";
  } else {
    els.buyBtn.style.display = "none";
    els.sellBtn.style.display = "block";
    els.waitMessage.style.display = "none";
  }

   // History
  const timeStr = new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit"
  });

  const lastEntry = predictionHistory[0];
  const isDuplicate = lastEntry &&
    lastEntry.decision === signal.decision &&
    lastEntry.price === signal.price;

  if (!isDuplicate) {
    predictionHistory.unshift({
      time: timeStr,
      symbol: SYMBOLS[currentSymbol].label,
      decision: signal.decision,
      price: signal.price
    });

    if (predictionHistory.length > 5) {
      predictionHistory.pop();
    }
  }

  if (els.predictionHistory) {
    els.predictionHistory.innerHTML = predictionHistory.map(item =>
      `<div>${item.time} • ${item.symbol}: ${item.decision} @ ${fmt(item.price)}</div>`
    ).join("");
  }

  // Notification
  if (
    (signal.decision === "BUY" || signal.decision === "SELL") &&
    signal.decision !== lastAlertedDecision
  ) {
    playAlertSound();

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`${SYMBOLS[currentSymbol].label} ${signal.decision}`, {
        body: `Price: ${fmt(signal.price)}`
      });
    } 
    else if ("Notification" in window && Notification.permission !== "denied") {
      Notification.requestPermission();
    }
  }

  lastAlertedDecision =
    (signal.decision === "BUY" || signal.decision === "SELL")
      ? signal.decision
      : null;
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.value = 880;
    osc.type = "sine";

    gain.gain.setValueAtTime(0.2, ctx.currentTime);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);

  } catch (e) {}
} 

// ---------- Fetch + Cycle ----------
async function runCycle() {
  if (isLoading) return;
  isLoading = true;

  els.loadingState.style.display = "block";
  els.errorState.style.display = "none";
  els.marketClosedMessage.style.display = "none";

  try {

const yahooUrl = encodeURIComponent(getApiUrl());

const res = await fetch("https://corsproxy.io/?url=" + yahooUrl, {
  method: "GET",
  cache: "no-cache"
});

    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.chart?.result?.[0]) throw new Error("Invalid response");

    const result = data.chart.result[0];
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const quote = result.indicators.quote[0];
    const timestamps = result.timestamp || [];

    const fresh = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.close[i] == null) continue;
      fresh.push({
        t: timestamps[i],
        o: quote.open[i] ?? quote.close[i],
        h: quote.high[i] ?? quote.close[i],
        l: quote.low[i] ?? quote.close[i],
        c: quote.close[i],
        v: quote.volume[i] ?? 0
      });
    }

    if (fresh.length >= 35) {
      candleHistory = fresh;
    } else {
      candleHistory.push({
        t: Math.floor(Date.now() / 1000),
        o: price, h: price, l: price, c: price,
        v: fresh[fresh.length - 1]?.v || 0
      });
      if (candleHistory.length > 200) candleHistory.shift();
    }

    lastGoodPrice = price;
    lastGoodCandles = candleHistory.slice();

    setText(els.livePrice, fmt(price));
    setText(els.lastUpdated, new Date().toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit"
    }));

    // Market open check
    const open = isMarketOpen();
    setText(els.marketStatus, open ? "Open" : "Closed");

if (!open) {
  els.loadingState.style.display = "none";
  els.marketClosedMessage.style.display = "block";
  
  setText(els.trend, "🔒 Market Closed");

  // Show last available AI analysis
if (candleHistory.length > 0) {
    const lastSignal = computeSignal(candleHistory);
    updateUI(lastSignal);
  }

  isLoading = false;
  return;
}

    if (candleHistory.length < 35) {
      setText(els.trend, "⏳ Loading Live Data...");
      isLoading = false;
      els.loadingState.style.display = "none";
      return;
    }

    const signal = computeSignal(candleHistory);
    updateUI(signal);

  } catch (err) {
    console.error(err);
    els.loadingState.style.display = "none";
    els.errorState.style.display = "block";
    setText(els.errorText, "Could not load live data. " + (err.message || ""));
    if (lastGoodPrice != null) {
      setText(els.livePrice, fmt(lastGoodPrice) + " (last known)");
    }
  }

  els.loadingState.style.display = "none";
  isLoading = false;
}

// ---------- TradingView ----------
function loadTradingViewChart() {
  if (!els.tvChart) return;
  els.tvChart.style.display = "block";
  els.tvFallback.style.display = "none";
  els.tvChart.innerHTML = "";

  if (typeof TradingView === "undefined") {
    els.tvChart.style.display = "none";
    els.tvFallback.style.display = "flex";
    return;
  }

  try {
    new TradingView.widget({
      autosize: true,
      symbol: SYMBOLS[currentSymbol].tvSymbol,
      interval: "15",
      timezone: "Asia/Kolkata",
      theme: "dark",
      style: "1",
 locale: "in",
      toolbar_bg: "#131722",
      enable_publishing: false,
      hide_top_toolbar: true,
      hide_legend: false,
      save_image: false,
      container_id: "tvChart"
    });
  } catch (e) {
    els.tvChart.style.display = "none";
    els.tvFallback.style.display = "flex";
  }
}

// ---------- Symbol Switch ----------
document.querySelectorAll(".symbol-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".symbol-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentSymbol = btn.dataset.symbol;

    setText(els.symbolLabel, SYMBOLS[currentSymbol].label);
    setText(els.livePrice, "Loading...");
    setText(els.trend, "⏳ Loading...");
    setText(els.confidence, "--");
    els.buyBtn.style.display = "none";
    els.sellBtn.style.display = "none";
    els.waitMessage.style.display = "block";
    els.marketClosedMessage.style.display = "none";
    els.errorState.style.display = "none";

    candleHistory = [];
    lastGoodCandles = [];
    lastGoodPrice = null;
    predictionHistory = [];
    lastAlertedDecision = null;
    if (els.predictionHistory) {
      els.predictionHistory.innerHTML = '<div class="empty-history">No signals yet</div>';
    }

    loadTradingViewChart();

    if (refreshTimer) clearInterval(refreshTimer);
    runCycle();
    refreshTimer = setInterval(runCycle, 30000);
  });
});

// ---------- Retry ----------
if (els.retryBtn) {
  els.retryBtn.addEventListener("click", () => {
    els.errorState.style.display = "none";
    runCycle();
  });
}
if (els.tvRetryBtn) {
  els.tvRetryBtn.addEventListener("click", loadTradingViewChart);
}

// ---------- Init ----------
function init() {
  setText(els.symbolLabel, SYMBOLS[currentSymbol].label);
  loadTradingViewChart();
  runCycle();
  refreshTimer = setInterval(runCycle, 30000);
}

window.addEventListener("DOMContentLoaded", init);
