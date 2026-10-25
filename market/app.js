/* V3 Bull dashboard: loads the published data, runs strategy.js in the browser and renders the three views. */
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const num = (v, d = 2) => v == null || !Number.isFinite(v) ? "–" : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1, sign = true) => v == null || !Number.isFinite(v) ? "–" :
  `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${sign && v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%</span>`;
const pctTxt = (v, d = 1) => v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: keep in memory */ } },
};
const MARKET_DEFAULTS = { US: { capital: 100000, lot: 1 }, TH: { capital: 1000000, lot: 100 } };
const state = { meta: null, market: store.get("v3.market", "US"), panels: {}, live: null, selected: null,
  statusFilter: "ALL", sortKey: "status", sortDir: 1, charts: {} };

const settings = m => ({ ...Strategy.DEFAULTS, ...MARKET_DEFAULTS[m], ...store.get(`v3.settings.${m}`, {}) });
const saveSettings = (m, s) => store.set(`v3.settings.${m}`, s);
const currency = () => state.meta.markets[state.market].currency;

// ---------- data ----------
async function getJSON(path) {
  const r = await fetch(`${path}?v=${encodeURIComponent(state.meta ? state.meta.generated : Date.now())}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function panel(m) {
  if (!state.panels[m]) state.panels[m] = Strategy.prepare(Strategy.decodePanel(await getJSON(`data/panel_${m}.json`), state.meta));
  return state.panels[m];
}

async function refresh() {
  $("asof").textContent = "Loading…";
  const P = await panel(state.market);
  state.live = Strategy.live(P, settings(state.market));
  $("asof").textContent = `Prices to ${state.live.date} · data built ${new Date(state.meta.generated).toLocaleString()}`;
  renderSignals();
  renderStrategyForm();
  $("bt-uni").textContent = `${state.meta.markets[state.market].name} · ${P.stocks.length} stocks`;
}

// ---------- live signals ----------
const ORDER = { BUY: 0, EXIT: 1, HOLD: 2, WAIT: 3, WATCH: 4, AVOID: 5 };
function renderSignals() {
  const L = state.live, p = L.params, mk = state.meta.markets[state.market];
  const counts = {}; L.rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const idxGap = L.index / L.indexSma200 - 1;
  $("kpis").innerHTML = [
    ["Macro gate", `<span class="badge ${L.gate ? "on" : "off"}">${L.gate ? "ON" : "OFF"}</span> <span class="mono">${num(L.index, 0)}</span>`,
      `${esc(state.live.backtest ? state.panels[state.market].indexName || mk.index : mk.index)} · ${pctTxt(idxGap)} vs SMA200 · ${L.gate ? "new buys allowed" : "new buys paused"}`],
    ["Positions", `${L.positions} / ${p.slots}`, `${Math.max(0, p.slots - L.positions)} slots free · cap ${p.sectorCap} per sector`],
    ["Unit size", `${num(L.unit, 0)} <small class="muted">${mk.currency}</small>`,
      p.sizing === "risk" ? `risk ${p.riskPct}% per trade · max ${p.maxPosPct}% per position` : `${num(p.capital, 0)} ÷ ${p.slots} slots`],
    ["Signals today", `<span class="up">${counts.BUY || 0}</span> buy · <span class="down">${counts.EXIT || 0}</span> exit`,
      `${counts.WAIT || 0} waiting · ${counts.WATCH || 0} watch`],
    ["Breadth", `${(L.breadth * 100).toFixed(0)}%`, "stocks above their 200-day average"],
    ["Model portfolio", `${num(L.equity, 0)} <small class="muted">${mk.currency}</small>`,
      `3-year run from ${num(p.capital, 0)} · ${pctTxt(L.backtest.metrics.total)} vs index ${pctTxt(L.backtest.benchMetrics.total)}`],
  ].map(([k, v, s]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");

  const secs = [...new Set(state.panels[state.market].stocks.map(s => s.sector))].sort();
  $("sec-cap").textContent = `max ${p.sectorCap} per sector`;
  $("sectors").innerHTML = secs.map(sec => {
    const n = L.sectors[sec] || 0, full = n >= p.sectorCap;
    return `<div class="sec"><span class="nm" title="${esc(sec)}">${esc(sec)}</span>
      <div class="meter"><i style="width:${Math.min(1, n / p.sectorCap) * 100}%;background:${full ? "var(--warning)" : "var(--series-3)"}"></i></div>
      <span class="mono">${n}/${p.sectorCap}</span></div>`;
  }).join("");

  $("status-chips").innerHTML = ["ALL", "BUY", "HOLD", "EXIT", "WAIT", "WATCH", "AVOID"].map(s =>
    `<button data-s="${s}" aria-pressed="${s === state.statusFilter}">${s === "ALL" ? "All" : s} <span class="muted">${s === "ALL" ? L.rows.length : counts[s] || 0}</span></button>`).join("");
  renderList();
  const first = state.selected && L.rows.find(r => r.sym === state.selected) ||
    L.rows.filter(r => r.status === "BUY" || r.status === "HOLD").sort((a, b) => ORDER[a.status] - ORDER[b.status])[0] || L.rows[0];
  if (first) selectStock(first.sym);
}

function renderList() {
  const L = state.live, f = $("filter").value.trim().toLowerCase();
  let rows = L.rows.filter(r => (state.statusFilter === "ALL" || r.status === state.statusFilter) &&
    (!f || `${r.sym} ${r.name} ${r.sector}`.toLowerCase().includes(f)));
  const k = state.sortKey, dir = state.sortDir;
  rows.sort((a, b) => {
    if (k === "status") return (ORDER[a.status] - ORDER[b.status]) * dir || (b.momentum || -9) - (a.momentum || -9);
    const x = a[k], y = b[k];
    if (x == null || Number.isNaN(x)) return 1; if (y == null || Number.isNaN(y)) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
  const fired = d => d ? new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" }) : "";
  document.querySelector("#list tbody").innerHTML = rows.map(r => `
    <tr data-sym="${esc(r.sym)}" class="${r.sym === state.selected ? "sel" : ""}">
      <td><div class="sym">${esc(r.sym.replace(/\.BK$/, ""))}</div><div class="sub">${esc(r.name)}</div></td>
      <td class="opt">${esc(r.sector)}</td>
      <td><span class="dots" title="${Strategy.CHECKS.map((c, i) => `${r.checks[i] ? "✓" : "✗"} ${c}`).join("\n")}">${r.checks.map(c => `<i class="${c ? "y" : ""}"></i>`).join("")}</span>
        <span class="muted mono">${r.pass}/5</span></td>
      <td class="opt mono">${fired(r.fired)}</td>
      <td class="num mono">${num(r.price)}</td>
      <td class="num mono">${pct(r.momentum, 0)}</td>
      <td><span class="st ${r.status}" title="${esc(r.reason || "")}">${r.status}</span></td></tr>`).join("") ||
    `<tr><td colspan="7" class="muted">No stocks match.</td></tr>`;
}

// ---------- chart + price plan ----------
const LOCALE = (() => { try { new Intl.DateTimeFormat(navigator.language); return navigator.language; } catch { return "en-US"; } })();
function makeChart(el, height) {
  const c = LightweightCharts.createChart(el, { height, autoSize: true, localization: { locale: LOCALE },
    layout: { background: { color: "transparent" }, textColor: css("--text-muted"), fontSize: 11 },
    grid: { vertLines: { color: css("--grid") }, horzLines: { color: css("--grid") } },
    rightPriceScale: { borderColor: css("--border") }, timeScale: { borderColor: css("--border") },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal } });
  return c;
}
function line(chart, color, width = 1.5, extra = {}) {
  return chart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });
}

async function selectStock(sym) {
  state.selected = sym;
  document.querySelectorAll("#list tbody tr").forEach(tr => tr.classList.toggle("sel", tr.dataset.sym === sym));
  const r = state.live.rows.find(x => x.sym === sym); if (!r) return;
  $("d-sym").textContent = r.sym.replace(/\.BK$/, "");
  $("d-name").textContent = `${r.name} · ${r.sector}`;
  $("d-status").innerHTML = `<span class="st ${r.status}">${r.status}</span>`;
  renderPlan(r);
  let bars;
  try { bars = Strategy.decodeOhlc(await getJSON(`data/ohlc/${sym.replace(/\./g, "_")}.json`)); }
  catch { $("price-chart").innerHTML = `<p class="muted">No chart data for ${esc(sym)}.</p>`; return; }
  if (state.selected !== sym) return;
  drawStock(bars, r);
}

function drawStock(b, r) {
  for (const k of ["price", "rsi"]) if (state.charts[k]) { state.charts[k].remove(); state.charts[k] = null; }
  $("price-chart").innerHTML = ""; $("rsi-chart").innerHTML = "";
  const pc = makeChart($("price-chart"), 340), rc = makeChart($("rsi-chart"), 110);
  state.charts.price = pc; state.charts.rsi = rc;
  const t = b.dates.map(d => d);
  const candles = pc.addCandlestickSeries({ upColor: css("--up"), downColor: css("--down"), borderVisible: false,
    wickUpColor: css("--up"), wickDownColor: css("--down") });
  candles.setData(b.dates.map((d, i) => ({ time: d, open: b.o[i], high: b.h[i], low: b.l[i], close: b.c[i] })));
  const ser = (a) => a.map((v, i) => Number.isFinite(v) ? { time: t[i], value: v } : null).filter(Boolean);
  line(pc, css("--series-4"), 1).setData(ser(Strategy.ema(b.c, 12)));
  line(pc, css("--series-5"), 1).setData(ser(Strategy.ema(b.c, 26)));
  line(pc, css("--series-2"), 1.5).setData(ser(Strategy.sma(b.c, 50)));
  line(pc, css("--series-3"), 1.5).setData(ser(Strategy.sma(b.c, 200)));
  const plan = r.position ? { stop: r.position.stop, target1: null } : r.plan;
  if (plan && Number.isFinite(plan.stop)) candles.createPriceLine({ price: plan.stop, color: css("--critical"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "stop" });
  if (!r.position && plan) for (const [k, v] of [["2R", plan.target1], ["3R", plan.target2]])
    if (Number.isFinite(v)) candles.createPriceLine({ price: v, color: css("--good"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: k });
  if (r.position) candles.createPriceLine({ price: r.position.entry, color: css("--accent"), lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: "entry" });
  const rs = Strategy.rsi(b.c);
  const rsiS = line(rc, css("--series-1"), 1.5, { lastValueVisible: true }); rsiS.setData(ser(rs));
  for (const lv of [30, 50, 70]) rsiS.createPriceLine({ price: lv, color: css("--border"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
  const from = t[Math.max(0, t.length - 260)];
  pc.timeScale().setVisibleRange({ from, to: t[t.length - 1] });
  rc.timeScale().setVisibleRange({ from, to: t[t.length - 1] });
  pc.timeScale().subscribeVisibleLogicalRangeChange(rg => rg && rc.timeScale().setVisibleLogicalRange(rg));
}

function renderPlan(r) {
  const cur = currency(), p = state.live.params, box = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
  let html = "";
  if (r.position) {
    const pos = r.position;
    html += `<h3>Model position</h3><div class="plan">${[
      box("Entry", `${num(pos.entry)} <small class="muted">${esc(pos.entryDate)}</small>`), box("Shares", num(pos.shares, 0)),
      box("P&amp;L", pct(pos.pnlPct)), box("Exit level now", num(pos.stop)),
    ].join("")}</div>`;
    if (r.status === "EXIT") html += `<p class="down" style="margin:8px 0 0">Sell at the next close: ${esc(r.reason)}.</p>`;
  }
  if (r.plan && (!r.position)) {
    const pl = r.plan;
    html += `<h3>Price plan for a new entry</h3><div class="plan">${[
      box("Buy zone", `${num(pl.zoneLow)} – ${num(pl.zoneHigh)}`), box("Stop", `${num(pl.stop)} <small class="down">${pctTxt(-pl.riskPct)}</small>`),
      box("Target 2R", num(pl.target1)), box("Target 3R", num(pl.target2)),
      box("Shares", `${num(pl.shares, 0)}${p.lot > 1 ? ` <small class="muted">(${p.lot}-share lots)</small>` : ""}`),
      box("Position value", `${num(pl.value, 0)} <small class="muted">${cur}</small>`), box("Loss if stopped", `${num(pl.maxLoss, 0)} <small class="muted">${cur}</small>`),
    ].join("")}</div>`;
    if (r.status !== "BUY") html += `<p class="muted" style="margin:8px 0 0">${r.status === "WAIT" ? `Qualifies, but ${esc(r.reason || "not ranked high enough for a free slot")}.` :
      "Not a buy signal: the plan shows what an entry today would look like."}</p>`;
  }
  html += `<ul class="checks">${Strategy.CHECKS.map((c, i) => `<li class="${r.checks[i] ? "y" : ""}">${c}</li>`).join("")}</ul>
    <p class="muted" style="font-size:12px;margin:6px 0 0">RSI ${num(r.rsi, 0)} · 6-month return ${pctTxt(r.momentum)} ·
      sizing ${p.sizing === "risk" ? `risk ${p.riskPct}% of ${num(p.capital, 0)} ${cur}` : `${p.slots} slots of ${num(p.capital, 0)} ${cur}`}</p>`;
  $("d-plan").innerHTML = html;
}

// ---------- backtest ----------
async function runBacktest() {
  const P = await panel(state.market), s = settings(state.market), years = Number($("bt-years").value);
  const T = P.dates.length - 1, from = Math.max(252, T - Math.round(252 * years));
  $("bt-status").textContent = "Running…";
  await new Promise(r => setTimeout(r, 20));
  const t0 = performance.now(), bt = Strategy.backtest(P, s, { from, to: T });
  $("bt-status").textContent = `${bt.dates[0]} → ${bt.dates.at(-1)} · ${Math.round(performance.now() - t0)} ms`;
  renderBacktest(bt);
}

function renderBacktest(bt) {
  const m = bt.metrics, b = bt.benchMetrics, cur = currency();
  $("bt-result").hidden = false;
  $("bt-kpis").innerHTML = [
    ["CAGR", pct(m.cagr), `index ${pctTxt(b.cagr)}`], ["Total return", pct(m.total), `index ${pctTxt(b.total)}`],
    ["Max drawdown", pct(m.maxDD), `index ${pctTxt(b.maxDD)}`], ["Sharpe", num(m.sharpe), `index ${num(b.sharpe)}`],
    ["Win rate", m.winRate == null ? "–" : `${(m.winRate * 100).toFixed(0)}%`, `avg win ${pctTxt(m.avgWin)} · avg loss ${pctTxt(m.avgLoss)}`],
    ["Trades", num(m.trades, 0), `profit factor ${num(m.profitFactor)} · avg hold ${num(m.avgDays, 0)} days`],
    ["Exposure", `${((m.exposure || 0) * 100).toFixed(0)}%`, "average share of equity invested"],
    ["Final equity", `${num(bt.equity.at(-1), 0)} <small class="muted">${cur}</small>`, `from ${num(bt.params.capital, 0)}`],
  ].map(([k, v, s]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");
  if (state.charts.eq) state.charts.eq.remove();
  $("eq-chart").innerHTML = "";
  const c = makeChart($("eq-chart"), 320); state.charts.eq = c;
  line(c, css("--series-1"), 2, { lastValueVisible: true }).setData(bt.dates.map((d, i) => ({ time: d, value: bt.equity[i] })));
  line(c, css("--text-muted"), 1.5, { lastValueVisible: true }).setData(bt.dates.map((d, i) => ({ time: d, value: bt.bench[i] })));
  c.timeScale().fitContent();
  $("bt-years-t").innerHTML = `<tr><th>Year</th><th class="num">Strategy</th><th class="num">Index</th><th class="num">Difference</th></tr>` +
    Object.keys(m.yearly).map(y => `<tr><td>${y}</td><td class="num">${pct(m.yearly[y])}</td><td class="num">${pct(b.yearly[y])}</td>
      <td class="num">${pct(m.yearly[y] - b.yearly[y])}</td></tr>`).join("");
  const reasons = {}; bt.trades.forEach(t => { const r = reasons[t.reason] ||= { n: 0, pnl: 0 }; r.n++; r.pnl += t.pnl; });
  $("bt-reasons").innerHTML = `<tr><th>Reason</th><th class="num">Trades</th><th class="num">P&amp;L (${cur})</th></tr>` +
    Object.entries(reasons).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num">${num(v.pnl, 0)}</td></tr>`).join("");
  $("bt-ntrades").textContent = `${bt.trades.length} closed · ${bt.state.positions.size} still open`;
  $("bt-trades").innerHTML = `<thead><tr><th>Stock</th><th>In</th><th>Out</th><th class="num">Return</th><th class="num">Days</th><th class="opt">Exit reason</th></tr></thead><tbody>` +
    bt.trades.slice().reverse().slice(0, 400).map(t => `<tr><td class="sym">${esc(t.sym.replace(/\.BK$/, ""))}</td><td class="mono">${t.entryDate}</td>
      <td class="mono">${t.exitDate}</td><td class="num">${pct(t.ret)}</td><td class="num">${t.days}</td><td class="opt muted">${esc(t.reason)}</td></tr>`).join("") + "</tbody>";
}

async function runAuto() {
  const P = await panel(state.market), s = settings(state.market), years = Number($("bt-years").value);
  const T = P.dates.length - 1, from = Math.max(252, T - Math.round(252 * Math.max(years, 2)));
  $("bt-auto").disabled = $("bt-run").disabled = true; $("bt-prog").hidden = false;
  const r = await Strategy.autoBacktest(P, s, null, { from, inSample: 0.7, onProgress: f => {
    $("bt-prog").firstElementChild.style.width = `${f * 100}%`; $("bt-status").textContent = `Testing combinations… ${Math.round(f * 100)}%`; } });
  $("bt-auto").disabled = $("bt-run").disabled = false; $("bt-prog").hidden = true;
  $("bt-status").textContent = `${r.combos} combinations tested`;
  $("auto-result").hidden = false;
  $("auto-sub").textContent = `optimised on ${r.inSample[0]} → ${r.inSample[1]}, tested on ${r.outSample[0]} → ${r.outSample[1]}`;
  const desc = x => Object.keys(x).length ? Object.entries(x).map(([k, v]) => `${({ slots: "slots", trailPct: "trail %", rsiMin: "RSI min", highWithinPct: "near-high %" })[k] || k} ${v}`).join(" · ") : "your current settings";
  const row = (x, label) => `<tr><td>${label || esc(desc(x.params))}</td><td class="num">${num(x.is.sharpe)}</td><td class="num">${pct(x.is.cagr)}</td>
    <td class="num"><b>${num(x.oos.sharpe)}</b></td><td class="num">${pct(x.oos.cagr)}</td><td class="num">${pct(x.oos.maxDD)}</td>
    <td>${x.params && Object.keys(x.params).length ? `<button class="btn" data-apply='${esc(JSON.stringify(x.params))}'>Apply</button>` : ""}</td></tr>`;
  $("auto-table").innerHTML = `<thead><tr><th>Settings</th><th class="num">Sharpe (optimised period)</th><th class="num">CAGR</th>
    <th class="num">Sharpe (unseen period)</th><th class="num">CAGR</th><th class="num">Max DD</th><th></th></tr></thead><tbody>` +
    r.top.map(x => row(x)).join("") + row(r.baseline, "<i>Your current settings</i>") +
    `<tr><td><i>Index buy &amp; hold</i></td><td></td><td></td><td class="num">${num(r.benchOos.sharpe)}</td><td class="num">${pct(r.benchOos.cagr)}</td>
      <td class="num">${pct(r.benchOos.maxDD)}</td><td></td></tr></tbody>`;
  const best = r.top[0], beat = best.oos.sharpe >= r.baseline.oos.sharpe;
  $("auto-note").innerHTML = `Ranked by Sharpe ratio in the optimised period only; the "unseen period" columns show how each choice did afterwards.
    ${beat ? "The top setting also did at least as well as your current settings on the unseen period."
      : "The top optimised setting did <b>worse</b> than your current settings on the unseen period, a sign of fitting noise; prefer robust settings that rank well in both."}`;
}

// ---------- strategy form ----------
const FIELDS = [
  ["capital", "Account size", "number", { step: 1000 }], ["sizing", "Position sizing", "select", { options: [["slots", "Equal slots"], ["risk", "Risk-based (volatility stop)"]] }],
  ["slots", "Max positions (slots)", "number", { min: 1, max: 100 }], ["sectorCap", "Max per sector", "number", { min: 1, max: 50 }],
  ["riskPct", "Risk per trade % (risk-based)", "number", { step: 0.25, min: 0.1 }], ["stopVolMult", "Stop = × 20-day volatility (risk-based)", "number", { step: 0.5, min: 0.5 }],
  ["maxPosPct", "Max position % of equity (risk-based)", "number", { min: 1, max: 100 }],
  ["gate", "Macro gate", "select", { options: [["sma200", "Index above SMA200"], ["sma50_200", "Index above SMA200 and SMA50 > SMA200"], ["off", "Off (always allow buys)"]] }],
  ["gateExitAll", "When the gate turns off", "select", { options: [["false", "Stop new buys only"], ["true", "Sell all positions"]] }],
  ["rsiMin", "RSI min", "number", { min: 0, max: 100 }], ["rsiMax", "RSI max", "number", { min: 0, max: 100 }],
  ["highWithinPct", "Within % of 52-week high", "number", { min: 1, max: 100 }], ["momLookback", "Momentum ranking days", "number", { min: 20, max: 250 }],
  ["rebalanceEvery", "Look for entries every N days", "number", { min: 1, max: 60 }],
  ["trailPct", "Trailing stop %", "number", { min: 1, max: 60 }],
  ["exitBelowSma50", "Exit on close below SMA50", "select", { options: [["true", "Yes"], ["false", "No"]] }],
  ["feeBps", "Fee per side (basis points)", "number", { min: 0, max: 200 }],
];
function renderStrategyForm() {
  const s = settings(state.market);
  $("st-mkt").textContent = `${state.meta.markets[state.market].name} · amounts in ${currency()}${s.lot > 1 ? ` · ${s.lot}-share lots` : ""}`;
  $("st-form").innerHTML = FIELDS.map(([k, label, type, o]) => `<label>${label}${type === "select"
    ? `<select data-k="${k}">${o.options.map(([v, t]) => `<option value="${v}" ${String(s[k]) === v ? "selected" : ""}>${t}</option>`).join("")}</select>`
    : `<input data-k="${k}" type="number" value="${s[k]}" ${Object.entries(o).map(([a, v]) => `${a}="${v}"`).join(" ")}>`}</label>`).join("");
}
function readStrategyForm() {
  const out = {};
  document.querySelectorAll("#st-form [data-k]").forEach(el => {
    const v = el.value; out[el.dataset.k] = v === "true" ? true : v === "false" ? false : (el.type === "number" ? Number(v) : v);
  });
  return out;
}

// ---------- routing & events ----------
function route() {
  const v = (location.hash.slice(1) || "signals");
  const view = ["signals", "backtest", "strategy"].includes(v) ? v : "signals";
  document.querySelectorAll(".view").forEach(s => { s.hidden = s.id !== `view-${view}`; });
  document.querySelectorAll(".tabs a").forEach(a => a.dataset.view === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (view === "signals" && state.charts.price) setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
}
window.addEventListener("hashchange", route);
$("mkt").addEventListener("click", async e => {
  const b = e.target.closest("button[data-m]"); if (!b || b.dataset.m === state.market) return;
  state.market = b.dataset.m; store.set("v3.market", state.market); state.selected = null; state.statusFilter = "ALL";
  document.querySelectorAll("#mkt button").forEach(x => x.setAttribute("aria-pressed", x === b));
  $("bt-result").hidden = $("auto-result").hidden = true; $("bt-status").textContent = "";
  await refresh();
});
$("status-chips").addEventListener("click", e => {
  const b = e.target.closest("button[data-s]"); if (!b) return;
  state.statusFilter = b.dataset.s;
  document.querySelectorAll("#status-chips button").forEach(x => x.setAttribute("aria-pressed", x === b));
  renderList();
});
$("filter").addEventListener("input", renderList);
document.querySelector("#list thead").addEventListener("click", e => {
  const th = e.target.closest("th[data-k]"); if (!th) return;
  if (state.sortKey === th.dataset.k) state.sortDir = -state.sortDir;
  else { state.sortKey = th.dataset.k; state.sortDir = ["sym", "sector", "status"].includes(th.dataset.k) ? 1 : -1; }
  renderList();
});
document.querySelector("#list tbody").addEventListener("click", e => { const tr = e.target.closest("tr[data-sym]"); if (tr) selectStock(tr.dataset.sym); });
$("bt-run").addEventListener("click", runBacktest);
$("bt-auto").addEventListener("click", runAuto);
$("auto-table").addEventListener("click", async e => {
  const b = e.target.closest("button[data-apply]"); if (!b) return;
  saveSettings(state.market, { ...store.get(`v3.settings.${state.market}`, {}), ...JSON.parse(b.dataset.apply) });
  await refresh(); renderStrategyForm(); await runBacktest();
  $("bt-status").textContent = "Settings applied to the strategy and re-tested.";
});
$("st-save").addEventListener("click", async () => {
  saveSettings(state.market, readStrategyForm()); await refresh(); $("st-msg").textContent = "Saved. Live signals and backtests now use these settings.";
});
$("st-reset").addEventListener("click", async () => {
  saveSettings(state.market, {}); await refresh(); $("st-msg").textContent = "Back to the default strategy.";
});

(async () => {
  const want = new URLSearchParams(location.search).get("symbol");  // links like ?symbol=PTT.BK
  if (want) { state.selected = want.toUpperCase(); state.market = /\.BK$/i.test(want) ? "TH" : "US"; }
  route();
  document.querySelectorAll("#mkt button").forEach(x => x.setAttribute("aria-pressed", x.dataset.m === state.market));
  try {
    state.meta = await (await fetch(`data/meta.json?t=${Date.now()}`)).json();
    await refresh();
  } catch (err) {
    $("asof").textContent = "Could not load data";
    $("kpis").innerHTML = `<div class="card">Data could not be loaded (${esc(err.message)}).</div>`;
  }
})();
