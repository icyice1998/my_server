/* Mode 2 · Algo Lab: user-built trading algorithms on top of strategy.js.
 *
 * An algorithm is plain JSON (saved in the browser):
 *   { name, entry: { join: "all"|"any", rules: [rule] }, exit: { rules: [rule], stopLossPct, takeProfitPct, maxHoldDays },
 *     rank: { ind, n, dir: "high"|"low" }, eval: { horizon, label: "beat"|"up", step } }
 *   rule = { a: operand, op: ">"|"<"|">="|"<="|"xup"|"xdown", b: operand }
 *   operand = { ind: "close"|"sma"|"ema"|"rsi"|"ret"|"vol"|"dhigh"|"dlow"|"macd"|"idx"|"idxsma"|"num", n?, v? }
 *
 * evaluate() scores every sampled stock-day: decision = entry rules pass; score = share of entry rules met plus a
 * small tie-break from the ranking indicator; label = forward return over `horizon` days > 0 ("up") or above the
 * index's forward return ("beat"). It reports ROC AUC (with a 95% interval), the confusion matrix and friends,
 * score deciles, and the same numbers on the in-sample and out-of-sample parts of the period.
 */
(function (root) {
  "use strict";
  const S = root.Strategy || (typeof require !== "undefined" ? require("./strategy.js") : null);
  const isNum = x => typeof x === "number" && Number.isFinite(x);

  const INDICATORS = {
    close: { label: "Close", n: false },
    sma: { label: "SMA", n: 50 }, ema: { label: "EMA", n: 20 }, rsi: { label: "RSI", n: 14 },
    ret: { label: "Return % over N days", n: 21 }, vol: { label: "Volatility % (annual, N days)", n: 20 },
    dhigh: { label: "% below N-day high", n: 252 }, dlow: { label: "% above N-day low", n: 252 },
    macd: { label: "MACD histogram % of price", n: false },
    idx: { label: "Index close", n: false }, idxsma: { label: "Index SMA", n: 200 },
    num: { label: "Number", n: false },
  };
  const OPS = { ">": "above", "<": "below", ">=": "at or above", "<=": "at or below", xup: "crosses above", xdown: "crosses below" };

  const PRESETS = [
    { name: "Trend pullback (RSI dip in an uptrend)",
      entry: { join: "all", rules: [
        { a: { ind: "close" }, op: ">", b: { ind: "sma", n: 200 } },
        { a: { ind: "rsi", n: 14 }, op: "<", b: { ind: "num", v: 40 } },
        { a: { ind: "idx" }, op: ">", b: { ind: "idxsma", n: 200 } }] },
      exit: { rules: [{ a: { ind: "rsi", n: 14 }, op: ">", b: { ind: "num", v: 65 } }], stopLossPct: 10, takeProfitPct: 0, maxHoldDays: 30 },
      rank: { ind: "ret", n: 126, dir: "high" }, eval: { horizon: 21, label: "beat", step: 5 } },
    { name: "Golden cross momentum",
      entry: { join: "all", rules: [
        { a: { ind: "ema", n: 12 }, op: "xup", b: { ind: "ema", n: 26 } },
        { a: { ind: "sma", n: 50 }, op: ">", b: { ind: "sma", n: 200 } }] },
      exit: { rules: [{ a: { ind: "ema", n: 12 }, op: "xdown", b: { ind: "ema", n: 26 } }], stopLossPct: 12, takeProfitPct: 0, maxHoldDays: 0 },
      rank: { ind: "ret", n: 63, dir: "high" }, eval: { horizon: 21, label: "beat", step: 5 } },
    { name: "55-day breakout",
      entry: { join: "all", rules: [
        { a: { ind: "dhigh", n: 55 }, op: ">=", b: { ind: "num", v: 0 } },
        { a: { ind: "close" }, op: ">", b: { ind: "sma", n: 50 } }] },
      exit: { rules: [{ a: { ind: "close" }, op: "<", b: { ind: "sma", n: 50 } }], stopLossPct: 8, takeProfitPct: 30, maxHoldDays: 0 },
      rank: { ind: "vol", n: 20, dir: "low" }, eval: { horizon: 21, label: "beat", step: 5 } },
    { name: "Mean reversion (oversold bounce)",
      entry: { join: "all", rules: [
        { a: { ind: "rsi", n: 14 }, op: "<", b: { ind: "num", v: 30 } },
        { a: { ind: "dhigh", n: 252 }, op: ">", b: { ind: "num", v: -40 } }] },
      exit: { rules: [{ a: { ind: "close" }, op: ">", b: { ind: "sma", n: 20 } }], stopLossPct: 10, takeProfitPct: 0, maxHoldDays: 15 },
      rank: { ind: "rsi", n: 14, dir: "low" }, eval: { horizon: 10, label: "beat", step: 5 } },
  ];

  // ---------- indicator series (cached per stock) ----------
  function series(P, i, o) {
    const s = P.stocks[i];
    if (o.ind === "idx") return P.idx;
    if (o.ind === "idxsma") return cached(P, "idx", `sma${o.n}`, () => S.sma(P.idx, o.n));
    const key = `${o.ind}${o.n || ""}`;
    return cached(s, "_c", key, () => {
      const c = s.c, n = o.n;
      switch (o.ind) {
        case "close": return c;
        case "sma": return S.sma(c, n);
        case "ema": return S.ema(c, n);
        case "rsi": return S.rsi(c, n);
        case "ret": return c.map((x, t) => t >= n && isNum(c[t - n]) ? (x / c[t - n] - 1) * 100 : NaN);
        case "vol": return S.volatility(c, n).map(x => x * Math.sqrt(252) * 100);
        case "dhigh": { const h = S.rollingMax(c, n); return c.map((x, t) => (x / h[t] - 1) * 100); }
        case "dlow": { const neg = c.map(x => isNum(x) ? -x : NaN), m = S.rollingMax(neg, n); return c.map((x, t) => (x / -m[t] - 1) * 100); }
        case "macd": { const e12 = S.ema(c, 12), e26 = S.ema(c, 26), line = e12.map((x, t) => x - e26[t]), sig = S.ema(line, 9);
          return line.map((x, t) => (x - sig[t]) / c[t] * 100); }
        default: throw new Error(`unknown indicator ${o.ind}`);
      }
    });
  }
  function cached(obj, slot, key, make) { const c = obj[slot] || (obj[slot] = {}); return c[key] || (c[key] = make()); }
  const value = (P, i, o, t) => o.ind === "num" ? Number(o.v) : series(P, i, o)[t];

  function ruleHolds(P, i, r, t) {
    const a = value(P, i, r.a, t), b = value(P, i, r.b, t);
    if (!isNum(a) || !isNum(b)) return false;
    switch (r.op) {
      case ">": return a > b; case "<": return a < b; case ">=": return a >= b; case "<=": return a <= b;
      case "xup": case "xdown": {
        if (t < 1) return false;
        const a0 = value(P, i, r.a, t - 1), b0 = value(P, i, r.b, t - 1);
        if (!isNum(a0) || !isNum(b0)) return false;
        return r.op === "xup" ? a0 <= b0 && a > b : a0 >= b0 && a < b;
      }
      default: return false;
    }
  }
  const SHORT = { close: "Close", sma: "SMA", ema: "EMA", rsi: "RSI", ret: "Return%", vol: "Volatility%", dhigh: "%From high",
    dlow: "%Above low", macd: "MACD hist%", idx: "Index", idxsma: "Index SMA" };
  const describeOperand = o => o.ind === "num" ? String(o.v) : `${SHORT[o.ind]}${o.n ? `(${o.n})` : ""}`;
  const describe = r => `${describeOperand(r.a)} ${OPS[r.op]} ${describeOperand(r.b)}`;

  /** Turn an algorithm into the entry / exit / rank hooks strategy.js understands. */
  function compile(P, algo) {
    const er = algo.entry.rules, any = algo.entry.join === "any";
    const met = (i, t) => er.reduce((k, r) => k + (ruleHolds(P, i, r, t) ? 1 : 0), 0);
    const entryFn = (i, t) => { if (!er.length) return false; const k = met(i, t); return any ? k > 0 : k === er.length; };
    const rk = algo.rank || { ind: "ret", n: 126, dir: "high" };
    const rankFn = (i, t) => { const v = value(P, i, rk, t); return isNum(v) ? (rk.dir === "low" ? -v : v) : NaN; };
    const x = algo.exit || {};
    const exitFn = (i, t, pos) => {
      const c = P.stocks[i].c[t]; if (!isNum(c)) return null;
      if (x.stopLossPct > 0 && c <= pos.entry * (1 - x.stopLossPct / 100)) return `stop loss ${x.stopLossPct}%`;
      if (x.takeProfitPct > 0 && c >= pos.entry * (1 + x.takeProfitPct / 100)) return `take profit ${x.takeProfitPct}%`;
      if (x.maxHoldDays > 0 && t - pos.t0 >= x.maxHoldDays) return `held ${x.maxHoldDays} days`;
      for (const r of x.rules || []) if (ruleHolds(P, i, r, t)) return describe(r);
      return null;
    };
    return { entryFn, exitFn, rankFn, met, ruleCount: er.length };
  }

  // ---------- decision statistics ----------
  /** ROC curve points and AUC (Mann-Whitney, ties counted half) for scores vs 0/1 labels. */
  function roc(scores, labels) {
    const n = scores.length, idx = Array.from({ length: n }, (_, k) => k).sort((a, b) => scores[b] - scores[a]);
    const P1 = labels.reduce((a, b) => a + b, 0), N0 = n - P1;
    if (!P1 || !N0) return { auc: NaN, points: [[0, 0], [1, 1]], pos: P1, neg: N0 };
    const points = [[0, 0]];
    let tp = 0, fp = 0, auc = 0;
    for (let k = 0; k < n;) {
      const sc = scores[idx[k]]; let dtp = 0, dfp = 0;
      while (k < n && scores[idx[k]] === sc) { labels[idx[k]] ? dtp++ : dfp++; k++; }
      auc += dfp * (tp + dtp / 2);   // positives ranked above this group of negatives, ties half
      tp += dtp; fp += dfp; points.push([fp / N0, tp / P1]);
    }
    auc /= P1 * N0;
    // Hanley & McNeil (1982) standard error
    const q1 = auc / (2 - auc), q2 = 2 * auc * auc / (1 + auc);
    const se = Math.sqrt((auc * (1 - auc) + (P1 - 1) * (q1 - auc * auc) + (N0 - 1) * (q2 - auc * auc)) / (P1 * N0));
    return { auc, se, lo: auc - 1.96 * se, hi: auc + 1.96 * se, points: thin(points), pos: P1, neg: N0 };
  }
  function thin(pts, max = 400) { if (pts.length <= max) return pts; const step = pts.length / max, out = [];
    for (let k = 0; k < max; k++) out.push(pts[Math.floor(k * step)]); out.push(pts[pts.length - 1]); return out; }

  function confusion(dec, lab, fwd) {
    let tp = 0, fp = 0, tn = 0, fn = 0, sigR = 0, noR = 0;
    for (let k = 0; k < dec.length; k++) {
      if (dec[k]) { lab[k] ? tp++ : fp++; sigR += fwd[k]; } else { lab[k] ? fn++ : tn++; noR += fwd[k]; }
    }
    const n = tp + fp + tn + fn, sig = tp + fp, base = (tp + fn) / n;
    const precision = sig ? tp / sig : NaN, recall = tp + fn ? tp / (tp + fn) : NaN, spec = tn + fp ? tn / (tn + fp) : NaN;
    const mccD = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
    return { tp, fp, tn, fn, n, signals: sig, base, precision, recall, specificity: spec, accuracy: (tp + tn) / n,
      f1: precision + recall ? 2 * precision * recall / (precision + recall) : NaN,
      mcc: mccD ? (tp * tn - fp * fn) / mccD : NaN, lift: precision / base,
      decisionAuc: (recall + spec) / 2,
      avgFwdSignal: sig ? sigR / sig : NaN, avgFwdOther: n - sig ? noR / (n - sig) : NaN };
  }

  function deciles(scores, lab, fwd, buckets = 10) {
    const idx = Array.from({ length: scores.length }, (_, k) => k).sort((a, b) => scores[a] - scores[b]);
    const out = [];
    for (let b = 0; b < buckets; b++) {
      const part = idx.slice(Math.floor(b * idx.length / buckets), Math.floor((b + 1) * idx.length / buckets));
      if (!part.length) continue;
      out.push({ bucket: b + 1, n: part.length, scoreLo: scores[part[0]], scoreHi: scores[part[part.length - 1]],
        hit: part.reduce((a, k) => a + lab[k], 0) / part.length, avgFwd: part.reduce((a, k) => a + fwd[k], 0) / part.length });
    }
    return out;
  }

  function spearman(x, y) {
    const rank = a => { const o = a.map((v, k) => [v, k]).sort((p, q) => p[0] - q[0]), r = new Array(a.length);
      for (let k = 0; k < o.length;) { let j = k; while (j < o.length && o[j][0] === o[k][0]) j++; for (let m = k; m < j; m++) r[o[m][1]] = (k + j - 1) / 2; k = j; } return r; };
    const rx = rank(x), ry = rank(y), n = x.length, mx = (n - 1) / 2;
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < n; k++) { sxy += (rx[k] - mx) * (ry[k] - mx); sxx += (rx[k] - mx) ** 2; syy += (ry[k] - mx) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  }

  function statsFor(rows) {
    const sc = rows.map(r => r.score), lab = rows.map(r => r.label), dec = rows.map(r => r.decision), fwd = rows.map(r => r.fwd);
    return { n: rows.length, roc: roc(sc, lab), confusion: confusion(dec, lab, fwd), deciles: deciles(sc, lab, fwd),
      ic: rows.length > 2 ? spearman(sc, fwd) : NaN };
  }

  /** Score every sampled stock-day in [from, to - horizon] and compute decision statistics. */
  function evaluate(P, algo, opt = {}) {
    const ev = { horizon: 21, label: "beat", step: 5, ...(algo.eval || {}) };
    const C = compile(P, algo), H = ev.horizon, T = P.dates.length - 1;
    const from = Math.max(opt.from ?? 252, 1), to = Math.min(opt.to ?? T, T) - H;
    const split = opt.split ?? Math.round(from + (to - from) * 0.7);
    const rows = [];
    for (let t = from; t <= to; t += ev.step) {
      const idxFwd = P.idx[t + H] / P.idx[t] - 1;
      // ranking indicator turned into a cross-sectional percentile for the tie-break
      const rk = [];
      for (let i = 0; i < P.stocks.length; i++) { const c = P.stocks[i].c; if (isNum(c[t]) && isNum(c[t + H])) rk.push([i, C.rankFn(i, t)]); }
      const sorted = rk.filter(x => isNum(x[1])).map(x => x[1]).sort((a, b) => a - b);
      for (const [i, rv] of rk) {
        const c = P.stocks[i].c, fwd = c[t + H] / c[t] - 1;
        const k = C.met(i, t), decision = C.entryFn(i, t);
        let pctl = 0.5;
        if (isNum(rv) && sorted.length) { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < rv) lo = m + 1; else hi = m; } pctl = lo / sorted.length; }
        rows.push({ t, i, decision, score: (C.ruleCount ? k / C.ruleCount : 0) + 0.01 * pctl,
          fwd, label: (ev.label === "up" ? fwd > 0 : fwd > idxFwd) ? 1 : 0 });
      }
    }
    return { eval: ev, from: P.dates[from], to: P.dates[to], split: P.dates[split], rows: rows.length,
      fromT: from, toT: to, splitT: split, ...(opt.keepRows ? { sample: rows } : {}),
      all: statsFor(rows), inSample: statsFor(rows.filter(r => r.t < split)), outSample: statsFor(rows.filter(r => r.t >= split)),
      rules: algo.entry.rules.map(describe) };
  }

  /** Portfolio backtest of the algorithm with the account / sizing settings from the Strategy tab. */
  function backtestAlgo(P, algo, settings, opt = {}) {
    const C = compile(P, algo);
    return S.backtest(P, { ...settings, entryFn: C.entryFn, exitFn: C.exitFn, rankFn: C.rankFn }, opt);
  }

  const api = { INDICATORS, OPS, PRESETS, series, compile, evaluate, backtestAlgo, roc, confusion, deciles, spearman, describe, ruleHolds };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Algo = api;
})(typeof self !== "undefined" ? self : this);
