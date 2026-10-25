/* V3 Bull strategy engine: bull-run signals, position sizing, backtest and auto-backtest.
 * Runs in the browser and in Node (tests). No look-ahead: decisions use data up to the close of day t and
 * are filled at the close of day t+1.
 *
 * panel = { dates: [...], index: [...], symbols: [...], closes: [[...], ...], sectors: [...], names: [...] }
 */
(function (root) {
  "use strict";
  const isNum = x => typeof x === "number" && Number.isFinite(x);

  const DEFAULTS = {
    // macro gate
    gate: "sma200",            // "sma200": index above its 200-day average | "sma50_200": also SMA50 > SMA200 | "off"
    gateExitAll: false,        // sell everything when the gate turns off (otherwise only new buys stop)
    // bull-run entry checks
    rsiMin: 50, rsiMax: 80,
    highWithinPct: 15,         // close within this % of its 52-week high
    rankBy: "momentum",        // ranking of qualifying stocks: "momentum" | "ml" (walk-forward model from ml.js, passed as rankFn)
    momLookback: 126,          // ranking: return over this many days
    rebalanceEvery: 5,         // look for new entries every N trading days
    // exits
    trailPct: 20,              // sell when price falls this % from its highest close since entry
    exitBelowSma50: true,      // sell when the close drops below SMA50
    // sizing
    sizing: "slots",           // "slots": equal slots | "risk": risk a fixed % of equity per position
    slots: 20, sectorCap: 4,
    riskPct: 1.0, stopVolMult: 3, maxPosPct: 15,
    // costs and account
    feeBps: 10, capital: 100000, lot: 1,
  };

  const CHECKS = ["Above SMA50 & SMA200", "SMA50 > SMA200", "EMA12 > EMA26", "RSI in band", "Near 52-week high"];

  // ---------- indicators (null-safe: series may start late) ----------
  function sma(a, n) {
    const out = new Array(a.length).fill(NaN); let s = 0, k = 0;
    for (let i = 0; i < a.length; i++) {
      if (!isNum(a[i])) { s = 0; k = 0; continue; }
      s += a[i]; k++;
      if (k > n) { s -= a[i - n]; k = n; }
      if (k === n) out[i] = s / n;
    }
    return out;
  }
  function ema(a, n) {
    const out = new Array(a.length).fill(NaN), al = 2 / (n + 1); let p = NaN, k = 0;
    for (let i = 0; i < a.length; i++) {
      if (!isNum(a[i])) continue;
      p = isNum(p) ? p + al * (a[i] - p) : a[i]; k++;
      if (k >= n) out[i] = p;
    }
    return out;
  }
  function rsi(a, n = 14) {
    const out = new Array(a.length).fill(NaN); let g = NaN, l = NaN, k = 0, prev = NaN;
    for (let i = 0; i < a.length; i++) {
      if (!isNum(a[i])) continue;
      if (isNum(prev)) {
        const d = a[i] - prev, up = Math.max(d, 0), dn = Math.max(-d, 0);
        g = isNum(g) ? g + (up - g) / n : up; l = isNum(l) ? l + (dn - l) / n : dn; k++;
        if (k >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      }
      prev = a[i];
    }
    return out;
  }
  function rollingMax(a, n) {
    const out = new Array(a.length).fill(NaN), dq = [];
    for (let i = 0; i < a.length; i++) {
      if (!isNum(a[i])) continue;
      while (dq.length && dq[0] <= i - n) dq.shift();
      while (dq.length && a[dq[dq.length - 1]] <= a[i]) dq.pop();
      dq.push(i);
      out[i] = a[dq[0]];
    }
    return out;
  }
  function volatility(a, n = 20) {   // daily std of returns
    const r = a.map((x, i) => i && isNum(x) && isNum(a[i - 1]) ? x / a[i - 1] - 1 : NaN);
    const out = new Array(a.length).fill(NaN);
    for (let i = n; i < a.length; i++) {
      let s = 0, s2 = 0, k = 0;
      for (let j = i - n + 1; j <= i; j++) if (isNum(r[j])) { s += r[j]; s2 += r[j] * r[j]; k++; }
      if (k >= n - 2) out[i] = Math.sqrt(Math.max(0, (s2 - s * s / k) / (k - 1)));
    }
    return out;
  }

  /** Indicator cache for one market panel (independent of strategy parameters). */
  function prepare(panel) {
    const stocks = panel.symbols.map((sym, i) => {
      const c = panel.closes[i];
      return { sym, name: panel.names ? panel.names[i] : sym, sector: panel.sectors ? panel.sectors[i] : "Other",
        c, sma50: sma(c, 50), sma200: sma(c, 200), ema12: ema(c, 12), ema26: ema(c, 26), rsi: rsi(c),
        hi252: rollingMax(c, 252), vol20: volatility(c) };
    });
    const idx = panel.index;
    return { dates: panel.dates, idx, idxSma50: sma(idx, 50), idxSma200: sma(idx, 200), stocks };
  }

  function gateOn(P, t, p) {
    if (p.gate === "off") return true;
    const on200 = P.idx[t] > P.idxSma200[t];
    return p.gate === "sma50_200" ? on200 && P.idxSma50[t] > P.idxSma200[t] : on200;
  }

  /** The five bull-run checks for stock s at day t: array of booleans (false when data is missing). */
  function checks(s, t, p) {
    const c = s.c[t];
    if (!isNum(c) || !isNum(s.sma200[t])) return [false, false, false, false, false];
    return [
      c > s.sma200[t] && (!p.exitBelowSma50 || c > s.sma50[t]),  // an entry below SMA50 would be sold the next day
      s.sma50[t] > s.sma200[t],
      s.ema12[t] > s.ema26[t],
      s.rsi[t] >= p.rsiMin && s.rsi[t] <= p.rsiMax,
      c >= s.hi252[t] * (1 - p.highWithinPct / 100),
    ];
  }
  const momentum = (s, t, p) => (t >= p.momLookback && isNum(s.c[t - p.momLookback]) && isNum(s.c[t])) ? s.c[t] / s.c[t - p.momLookback] - 1 : NaN;

  function stopLevel(s, t, peak, p) {
    let stop = peak * (1 - p.trailPct / 100);
    if (p.exitBelowSma50 && isNum(s.sma50[t])) stop = Math.max(stop, s.sma50[t]);
    return stop;
  }
  function exitReason(s, t, pos, p) {
    const c = s.c[t]; if (!isNum(c)) return null;
    if (c <= pos.peak * (1 - p.trailPct / 100)) return `trailing stop ${p.trailPct}%`;
    if (p.exitBelowSma50 && isNum(s.sma50[t]) && c < s.sma50[t]) return "close below SMA50";
    return null;
  }

  /** Shares for a new position given current equity. */
  function sizeShares(s, t, equity, p) {
    const c = s.c[t];
    let value;
    if (p.sizing === "risk") {
      const stopDist = Math.max(p.stopVolMult * (s.vol20[t] || 0.02) * c, c * 0.02);
      value = Math.min((equity * p.riskPct / 100) / stopDist * c, equity * p.maxPosPct / 100);
    } else {
      value = equity / p.slots;
    }
    return Math.floor(value / c / p.lot) * p.lot;
  }

  /** Decide orders at the close of day t. Returns {sells:[{i, reason}], buys:[{i, shares}], ranked, blocked}. */
  function decide(P, t, state, p, forceRebalance) {
    const sells = [], buys = [], blocked = {};
    const gate = gateOn(P, t, p);
    for (const [i, pos] of state.positions) {
      const s = P.stocks[i];
      if (isNum(s.c[t])) pos.peak = Math.max(pos.peak, s.c[t]);
      const why = (!gate && p.gateExitAll) ? "macro gate off"
        : p.exitFn ? p.exitFn(i, t, pos) : exitReason(s, t, pos, p);  // exitFn: custom algorithm (algo.js)
      if (why) sells.push({ i, reason: why });
    }
    const ranked = [];
    const rebalance = forceRebalance || (t - state.start) % p.rebalanceEvery === 0;
    if (rebalance) {
      for (let i = 0; i < P.stocks.length; i++) {
        const s = P.stocks[i];
        const pass = p.entryFn ? p.entryFn(i, t) : checks(s, t, p).every(Boolean);
        if (pass) { const m = p.rankFn ? p.rankFn(i, t) : momentum(s, t, p); if (isNum(m)) ranked.push({ i, m }); }
      }
      ranked.sort((a, b) => b.m - a.m);
      const selling = new Set(sells.map(x => x.i));
      const sector = {};
      let held = 0;
      for (const [i] of state.positions) if (!selling.has(i)) { held++; const sec = P.stocks[i].sector; sector[sec] = (sector[sec] || 0) + 1; }
      const maxPos = p.sizing === "risk" ? Math.max(p.slots, 1) : p.slots;
      for (const { i } of ranked) {
        if (state.positions.has(i)) continue;
        const s = P.stocks[i], sec = s.sector;
        if (!gate) { blocked[i] = "macro gate off"; continue; }
        if (held >= maxPos) { blocked[i] = "no free slot"; continue; }
        if ((sector[sec] || 0) >= p.sectorCap) { blocked[i] = `sector cap (${p.sectorCap}) reached`; continue; }
        const shares = sizeShares(s, t, state.equity, p);
        if (shares <= 0) { blocked[i] = "position smaller than one lot"; continue; }
        buys.push({ i, shares }); held++; sector[sec] = (sector[sec] || 0) + 1;
      }
    }
    return { sells, buys, ranked, blocked, gate, rebalance };
  }

  /** Run the strategy over [from, to] (bar indexes). Returns equity curve, trades, metrics and final state. */
  function backtest(P, params = {}, opt = {}) {
    const p = { ...DEFAULTS, ...params };
    const from = Math.max(opt.from ?? 252, 252), to = Math.min(opt.to ?? P.dates.length - 1, P.dates.length - 1);
    const fee = p.feeBps / 10000;
    const state = { cash: p.capital, positions: new Map(), equity: p.capital, start: from };
    const equity = [], invested = [], trades = [];
    let orders = { sells: [], buys: [] };
    const last = new Array(P.stocks.length).fill(NaN);
    for (let t = from; t <= to; t++) {
      for (let i = 0; i < P.stocks.length; i++) if (isNum(P.stocks[i].c[t])) last[i] = P.stocks[i].c[t];
      // 1) fill yesterday's orders at today's close: sells first, then buys with the cash available
      for (const { i, reason } of orders.sells) {
        const pos = state.positions.get(i); if (!pos) continue;
        const px = last[i], proceeds = pos.shares * px * (1 - fee);
        state.cash += proceeds;
        trades.push({ sym: P.stocks[i].sym, sector: P.stocks[i].sector, entryDate: P.dates[pos.t0], entry: pos.entry,
          exitDate: P.dates[t], exit: px, shares: pos.shares, pnl: proceeds - pos.cost, ret: proceeds / pos.cost - 1,
          days: t - pos.t0, reason });
        state.positions.delete(i);
      }
      for (const { i, shares } of orders.buys) {
        const px = last[i]; if (!isNum(px)) continue;
        let n = shares;
        while (n > 0 && n * px * (1 + fee) > state.cash) n -= p.lot;
        if (n <= 0) continue;
        const cost = n * px * (1 + fee);
        state.cash -= cost;
        state.positions.set(i, { shares: n, entry: px, cost, t0: t, peak: px });
      }
      // 2) mark to market
      let mv = 0;
      for (const [i, pos] of state.positions) mv += pos.shares * last[i];
      state.equity = state.cash + mv;
      equity.push(state.equity); invested.push(mv / state.equity);
      // 3) decide at today's close, fill tomorrow
      orders = t < to ? decide(P, t, state, p, false) : { sells: [], buys: [] };
    }
    const dates = P.dates.slice(from, to + 1);
    const bench = P.idx.slice(from, to + 1).map(x => x / P.idx[from] * p.capital);
    return { params: p, dates, equity, bench, invested, trades, state, last,
      metrics: metrics(equity, dates, trades, invested), benchMetrics: metrics(bench, dates, [], null), from, to };
  }

  function metrics(eq, dates, trades, invested) {
    const n = eq.length; if (n < 2) return {};
    const r = []; for (let i = 1; i < n; i++) r.push(eq[i] / eq[i - 1] - 1);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
    let peak = eq[0], mdd = 0;
    for (const x of eq) { peak = Math.max(peak, x); mdd = Math.min(mdd, x / peak - 1); }
    const years = (new Date(dates[n - 1]) - new Date(dates[0])) / (365.25 * 864e5);
    const yearly = {};
    let prevEnd = eq[0];
    for (let i = 0; i < n; i++) {
      const y = dates[i].slice(0, 4);
      if (i === n - 1 || dates[i + 1].slice(0, 4) !== y) { yearly[y] = eq[i] / prevEnd - 1; prevEnd = eq[i]; }
    }
    const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
    const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
    return {
      total: eq[n - 1] / eq[0] - 1, cagr: years > 0 ? (eq[n - 1] / eq[0]) ** (1 / years) - 1 : 0,
      vol: sd * Math.sqrt(252), sharpe: sd ? mean / sd * Math.sqrt(252) : 0, maxDD: mdd, yearly,
      trades: trades.length, winRate: trades.length ? wins.length / trades.length : null,
      avgWin: wins.length ? wins.reduce((a, t) => a + t.ret, 0) / wins.length : null,
      avgLoss: losses.length ? losses.reduce((a, t) => a + t.ret, 0) / losses.length : null,
      profitFactor: gl ? gw / gl : null,
      avgDays: trades.length ? trades.reduce((a, t) => a + t.days, 0) / trades.length : null,
      exposure: invested ? invested.reduce((a, b) => a + b, 0) / invested.length : null,
    };
  }

  /** Today's view: run the strategy to the last bar, then classify every stock and suggest prices / size. */
  function live(P, params = {}, opt = {}) {
    const p = { ...DEFAULTS, ...params };
    const T = P.dates.length - 1;
    const bt = backtest(P, p, { from: opt.from ?? Math.max(252, T - 252 * 3), to: T });
    const st = bt.state, d = decide(P, T, st, p, true);
    const sell = new Map(d.sells.map(x => [x.i, x.reason])), buy = new Map(d.buys.map(x => [x.i, x.shares]));
    const rows = P.stocks.map((s, i) => {
      const ok = checks(s, T, p), pass = ok.filter(Boolean).length, pos = st.positions.get(i), c = s.c[T];
      let status;
      if (pos) status = sell.has(i) ? "EXIT" : "HOLD";
      else if (buy.has(i)) status = "BUY";
      else if (pass === 5) status = "WAIT";
      else if (pass >= 3) status = "WATCH";
      else status = "AVOID";
      // first day of the current all-checks streak
      let fired = null;
      if (pass === 5) { let k = T; while (k > 0 && checks(s, k - 1, p).every(Boolean)) k--; fired = P.dates[k]; }
      return { i, sym: s.sym, name: s.name, sector: s.sector, price: c, checks: ok, pass, status, fired,
        momentum: momentum(s, T, p), rsi: s.rsi[T], reason: sell.get(i) || d.blocked[i] || null,
        position: pos ? { shares: pos.shares, entry: pos.entry, entryDate: P.dates[pos.t0], pnlPct: c / pos.entry - 1,
          stop: stopLevel(s, T, pos.peak, p) } : null,
        plan: isNum(c) ? plan(s, T, p) : null };
    });
    const sectors = {};
    for (const [i] of st.positions) { const sec = P.stocks[i].sector; sectors[sec] = (sectors[sec] || 0) + 1; }
    const breadth = P.stocks.filter(s => isNum(s.c[T]) && isNum(s.sma200[T])).map(s => s.c[T] > s.sma200[T]);
    return { date: P.dates[T], gate: gateOn(P, T, p), index: P.idx[T], indexSma200: P.idxSma200[T], indexSma50: P.idxSma50[T],
      positions: st.positions.size, slots: p.slots, equity: st.equity, cash: st.cash, sectors, rows, backtest: bt,
      breadth: breadth.filter(Boolean).length / Math.max(1, breadth.length), unit: p.capital / p.slots, params: p };
  }

  /** Price plan for a new entry at today's close: buy zone, stop, targets, shares for the account. */
  function plan(s, t, p) {
    const c = s.c[t], stop = stopLevel(s, t, c, p), risk = c - stop;
    const zoneLow = isNum(s.ema12[t]) ? Math.min(c, s.ema12[t]) : c;
    const shares = sizeShares(s, t, p.capital, p);
    return { entry: c, zoneLow, zoneHigh: c, stop, riskPct: risk / c, target1: c + 2 * risk, target2: c + 3 * risk,
      shares, value: shares * c, maxLoss: shares * risk };
  }

  /** Grid search on the in-sample part, then report how the best settings did out of sample. */
  async function autoBacktest(P, base = {}, grid = null, opt = {}) {
    const g = grid || { slots: [10, 20, 30], trailPct: [10, 15, 20, 25], rsiMin: [45, 50, 55], highWithinPct: [10, 20, 30] };
    const T = P.dates.length - 1, from = Math.max(252, opt.from ?? 252), split = Math.round(from + (T - from) * (opt.inSample ?? 0.7));
    const keys = Object.keys(g), combos = [];
    (function rec(k, cur) { if (k === keys.length) { combos.push({ ...cur }); return; } for (const v of g[keys[k]]) rec(k + 1, { ...cur, [keys[k]]: v }); })(0, {});
    const results = [];
    for (let n = 0; n < combos.length; n++) {
      const prm = { ...DEFAULTS, ...base, ...combos[n] };
      const is = backtest(P, prm, { from, to: split });
      results.push({ params: combos[n], is: is.metrics });
      if (opt.onProgress && n % 4 === 0) { opt.onProgress((n + 1) / combos.length); await new Promise(r => setTimeout(r, 0)); }
    }
    results.sort((a, b) => b.is.sharpe - a.is.sharpe);
    const top = results.slice(0, opt.top ?? 8);
    for (const r of top) r.oos = backtest(P, { ...DEFAULTS, ...base, ...r.params }, { from: split + 1, to: T }).metrics;
    const baseline = { params: {}, is: backtest(P, { ...DEFAULTS, ...base }, { from, to: split }).metrics,
      oos: backtest(P, { ...DEFAULTS, ...base }, { from: split + 1, to: T }).metrics };
    const benchOos = backtest(P, { ...DEFAULTS, ...base, gate: "off", slots: 1 }, { from: split + 1, to: T }).benchMetrics;
    if (opt.onProgress) opt.onProgress(1);
    return { combos: combos.length, inSample: [P.dates[from], P.dates[split]], outSample: [P.dates[split + 1], P.dates[T]],
      top, baseline, benchOos, all: results };
  }

  /** Decode a published panel file into the engine's panel shape. */
  function decodePanel(j, meta) {
    const dates = [], d = new Date(`${j.d0}T00:00:00Z`);
    for (const g of j.dt) { d.setUTCDate(d.getUTCDate() + g); dates.push(d.toISOString().slice(0, 10)); }
    const info = new Map((meta ? meta.stocks : []).map(x => [x.s, x]));
    return { dates, index: j.index.c, indexName: j.index.name, symbols: j.s, closes: j.c.map(a => a.map(x => x ?? NaN)),
      names: j.s.map(s => (info.get(s) || {}).n || s), sectors: j.s.map(s => (info.get(s) || {}).sec || "Other") };
  }
  function decodeOhlc(j) {
    const dates = [], d = new Date(`${j.d0}T00:00:00Z`);
    for (const g of j.dt) { d.setUTCDate(d.getUTCDate() + g); dates.push(d.toISOString().slice(0, 10)); }
    return { dates, o: j.o, h: j.h, l: j.l, c: j.c, v: j.v };
  }

  const api = { DEFAULTS, CHECKS, sma, ema, rsi, rollingMax, volatility, prepare, checks, gateOn, decide, backtest, metrics,
    live, plan, sizeShares, autoBacktest, decodePanel, decodeOhlc };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Strategy = api;
})(typeof self !== "undefined" ? self : this);
