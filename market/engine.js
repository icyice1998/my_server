/* Market Analyzer browser engine.
 * A JavaScript port of market_analyzer/{technical,elliott,smc,context,forecast,model}.py, so any asset in
 * the published price bundle can be analysed in the browser, with no server and no GitHub round trip.
 * Input bars: { dates: ["YYYY-MM-DD"], o: [], h: [], l: [], c: [], v: [] }. Works in browsers and Node. */
(function (root) {
  "use strict";
  const NaNv = Number.NaN;
  const isNum = x => typeof x === "number" && Number.isFinite(x);
  const last = a => a[a.length - 1];
  const clip = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const mean = a => { let s = 0, n = 0; for (const x of a) if (isNum(x)) { s += x; n++; } return n ? s / n : NaNv; };
  const median = a => { const s = a.filter(isNum).sort((x, y) => x - y); if (!s.length) return NaNv;
    const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const quantile = (a, q) => { const s = a.filter(isNum).sort((x, y) => x - y); if (!s.length) return NaNv;
    const p = (s.length - 1) * q, i = Math.floor(p); return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (p - i) : s[i]; };
  const std = (a, ddof = 1) => { const v = a.filter(isNum); if (v.length <= ddof) return NaNv; const m = mean(v);
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - ddof)); };
  const maxOf = (a, i0 = 0, i1 = a.length) => { let m = -Infinity; for (let i = Math.max(0, i0); i < i1; i++) if (a[i] > m) m = a[i]; return m; };
  const minOf = (a, i0 = 0, i1 = a.length) => { let m = Infinity; for (let i = Math.max(0, i0); i < i1; i++) if (a[i] < m) m = a[i]; return m; };

  // ---------- series helpers (pandas semantics) ----------
  const rolling = (a, n, fn, minP = n) => a.map((_, i) => {
    if (i + 1 < minP) return NaNv;
    const w = a.slice(Math.max(0, i - n + 1), i + 1);
    return w.some(x => !isNum(x)) && minP === n ? NaNv : fn(w.filter(isNum));
  });
  const sma = (a, n) => { const out = new Array(a.length).fill(NaNv); let s = 0;
    for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) out[i] = s / n; } return out; };
  const ewm = (a, alpha) => { const out = new Array(a.length).fill(NaNv); let prev = NaNv;
    for (let i = 0; i < a.length; i++) { const x = a[i];
      if (!isNum(x)) { out[i] = prev; continue; }
      prev = isNum(prev) ? prev + alpha * (x - prev) : x; out[i] = prev; } return out; };
  const ema = (a, n) => ewm(a, 2 / (n + 1));
  const diff = (a, k = 1) => a.map((x, i) => i >= k ? x - a[i - k] : NaNv);
  const shiftRatio = (a, k) => a.map((x, i) => i >= k ? x / a[i - k] - 1 : NaNv);

  function rsi(c, n = 14) {
    const d = diff(c);
    const g = ewm(d.map(x => isNum(x) ? Math.max(x, 0) : NaNv), 1 / n);
    const l = ewm(d.map(x => isNum(x) ? Math.max(-x, 0) : NaNv), 1 / n);
    return c.map((_, i) => (isNum(g[i]) && isNum(l[i]) && l[i] !== 0) ? 100 - 100 / (1 + g[i] / l[i]) : 100);
  }
  function macdParts(c) {
    const e12 = ema(c, 12), e26 = ema(c, 26);
    const line = e12.map((x, i) => x - e26[i]); const sig = ema(line, 9);
    return { line, sig, hist: line.map((x, i) => x - sig[i]) };
  }
  function trueRange(b) { return b.c.map((_, i) => i === 0 ? b.h[0] - b.l[0]
    : Math.max(b.h[i] - b.l[i], Math.abs(b.h[i] - b.c[i - 1]), Math.abs(b.l[i] - b.c[i - 1]))); }
  const atr = (b, n = 14) => ewm(trueRange(b), 1 / n);
  function adx(b, n = 14) {
    const len = b.c.length, pdm = new Array(len).fill(0), mdm = new Array(len).fill(0);
    for (let i = 1; i < len; i++) { const up = b.h[i] - b.h[i - 1], dn = b.l[i - 1] - b.l[i];
      if (up > dn && up > 0) pdm[i] = up; if (dn > up && dn > 0) mdm[i] = dn; }
    const tr = atr(b, n), p = ewm(pdm, 1 / n), m = ewm(mdm, 1 / n);
    const dx = tr.map((t, i) => { if (!t) return NaNv; const pi = 100 * p[i] / t, mi = 100 * m[i] / t;
      return pi + mi ? 100 * Math.abs(pi - mi) / (pi + mi) : NaNv; });
    return ewm(dx, 1 / n);
  }
  function regressionSlope(c, n) {
    const y = c.slice(-n).map(Math.log); if (y.length < 10) return [0, 0];
    const k = y.length, xm = (k - 1) / 2, ym = mean(y); let sxy = 0, sxx = 0;
    for (let i = 0; i < k; i++) { sxy += (i - xm) * (y[i] - ym); sxx += (i - xm) ** 2; }
    const slope = sxy / sxx, icpt = ym - slope * xm; let res = 0, tot = 0;
    for (let i = 0; i < k; i++) { res += (y[i] - (slope * i + icpt)) ** 2; tot += (y[i] - ym) ** 2; }
    return [(Math.exp(slope * 252) - 1) * 100, tot > 0 ? 1 - res / tot : 0];
  }

  // ---------- technical ----------
  function findPivots(s, w = 5) {
    const highs = [], lows = [];
    for (let i = w; i < s.length - w; i++) {
      const mx = maxOf(s, i - w, i + w + 1), mn = minOf(s, i - w, i + w + 1);
      if (s[i] === mx) highs.push(i); if (s[i] === mn) lows.push(i);
    }
    const dedupe = idx => { const keep = []; let lastPos = -w - 1;
      for (const p of idx) { if (p - lastPos > w) keep.push(p); lastPos = p; } return keep; };
    return { highs: dedupe(highs), lows: dedupe(lows) };
  }
  function supportResistance(b, w = 5, tol = 0.02, maxLevels = 3) {
    const off = Math.max(0, b.c.length - 250), c = b.c.slice(off);
    const { highs, lows } = findPivots(c, w);
    const levels = [...highs, ...lows].map(i => c[i]).sort((x, y) => x - y);
    const clusters = [];
    for (const p of levels) { const lc = last(clusters);
      if (lc && Math.abs(p - mean(lc)) / mean(lc) <= tol) lc.push(p); else clusters.push([p]); }
    const price = last(b.c);
    const ranked = clusters.map((cl, i) => [cl, i]).sort((x, y) => y[0].length - x[0].length || x[1] - y[1]).map(x => mean(x[0]));
    let sup = ranked.filter(m => m < price).sort((x, y) => y - x).slice(0, maxLevels);
    let res = ranked.filter(m => m > price).sort((x, y) => x - y).slice(0, maxLevels);
    if (!res.length) res = [maxOf(b.h, b.h.length - 252)];
    if (!sup.length) sup = [minOf(b.l, b.l.length - 252)];
    return [sup, res];
  }
  function detectPatterns(b, w = 5, tol = 0.03) {
    const c = b.c, found = [], off = Math.max(0, c.length - 250), cc = c.slice(off);
    const { highs, lows } = findPivots(cc, w);
    const H = highs.map(i => cc[i]), L = lows.map(i => cc[i]);
    if (H.length >= 2 && L.length >= 2) {
      const hh = last(H) > H[H.length - 2], hl = last(L) > L[L.length - 2];
      found.push(hh && hl ? "Recent swings: higher highs & higher lows" : !hh && !hl ? "Recent swings: lower highs & lower lows"
        : "Recent swings: mixed (range / consolidation)");
    }
    if (H.length >= 2) { const h1 = H[H.length - 2], h2 = last(H);
      const trough = minOf(cc, highs[highs.length - 2], last(highs) + 1);
      if (Math.abs(h1 - h2) / h1 <= tol && trough < Math.min(h1, h2) * (1 - 2 * tol))
        found.push(`Double top near ${Math.max(h1, h2).toFixed(2)} (${last(c) < trough ? "confirmed" : "watch neckline"}, neckline ${trough.toFixed(2)})`); }
    if (L.length >= 2) { const l1 = L[L.length - 2], l2 = last(L);
      const peak = maxOf(cc, lows[lows.length - 2], last(lows) + 1);
      if (Math.abs(l1 - l2) / l1 <= tol && peak > Math.max(l1, l2) * (1 + 2 * tol))
        found.push(`Double bottom near ${Math.min(l1, l2).toFixed(2)} (${last(c) > peak ? "confirmed" : "watch neckline"}, neckline ${peak.toFixed(2)})`); }
    if (c.length >= 201) { const s50 = sma(c, 50), s200 = sma(c, 200), n = c.length;
      const d0 = s50[n - 21] - s200[n - 21], d1 = s50[n - 1] - s200[n - 1];
      if (d0 < 0 && d1 > 0) found.push("Golden cross (SMA50 crossed above SMA200, last 20 bars)");
      else if (d0 > 0 && d1 < 0) found.push("Death cross (SMA50 crossed below SMA200, last 20 bars)"); }
    if (c.length >= 60) { const n = c.length, pmax = maxOf(c, n - 56, n - 1), pmin = minOf(c, n - 56, n - 1);
      if (last(c) > pmax) found.push("Breakout above 55-bar high"); else if (last(c) < pmin) found.push("Breakdown below 55-bar low"); }
    return found;
  }
  function technical(b) {
    const c = b.c, price = last(c), n = c.length;
    const lastSma = k => n >= k ? last(sma(c, k)) : NaNv;
    const s20 = lastSma(20), s50 = lastSma(50), s200 = lastSma(200);
    const r = last(rsi(c)), m = macdParts(c), a = last(atr(b));
    const flat = b.h.every((x, i) => x === b.l[i]);
    const ad = flat ? NaNv : last(adx(b));
    const [slope3, r23] = regressionSlope(c, 63), [slope1, r21] = regressionSlope(c, 252);
    const [sup, res] = supportResistance(b);
    let score = 0;
    for (const ma of [s20, s50, s200]) if (isNum(ma)) score += price > ma ? 15 : -15;
    if (isNum(s50) && isNum(s200)) score += s50 > s200 ? 10 : -10;
    score += clip(slope3 / 2, -20, 20) * Math.max(r23, 0.3);
    score += last(m.hist) > 0 ? 10 : -10;
    score = clip(score, -100, 100);
    const trend = score >= 40 ? "Strong uptrend" : score >= 15 ? "Uptrend" : score > -15 ? "Sideways" : score > -40 ? "Downtrend" : "Strong downtrend";
    const rets = c.slice(1).map((x, i) => x / c[i] - 1).slice(-252);
    return { price, sma20: s20, sma50: s50, sma200: s200, rsi14: r,
      rsi_state: r >= 70 ? "overbought" : r <= 30 ? "oversold" : "neutral",
      macd: last(m.line), macd_signal: last(m.sig), macd_hist: last(m.hist), atr14: a, atr_pct: a / price * 100,
      adx14: ad, trend_strength: isNum(ad) ? (ad >= 25 ? "strong" : "weak") : "n/a",
      slope_3m_ann_pct: slope3, r2_3m: r23, slope_1y_ann_pct: slope1, r2_1y: r21,
      volatility_ann_pct: std(rets) * Math.sqrt(252) * 100, support: sup, resistance: res,
      patterns: detectPatterns(b), trend_score: score, trend };
  }

  // ---------- Elliott ----------
  const DEGREES = [["minor", 3], ["intermediate", 5], ["primary", 8]];
  function zigzag(b, thr) {
    const H = b.h, L = b.l, piv = []; let dir = 0, extHi = H[0], extLo = L[0], hiPos = 0, loPos = 0;
    for (let i = 1; i < H.length; i++) {
      if (dir >= 0 && H[i] >= extHi) { extHi = H[i]; hiPos = i; }
      if (dir <= 0 && L[i] <= extLo) { extLo = L[i]; loPos = i; }
      if (dir >= 0 && extHi - L[i] >= thr && (dir === 1 || hiPos > loPos)) { piv.push([hiPos, extHi, "H"]); dir = -1; extLo = L[i]; loPos = i; }
      else if (dir <= 0 && H[i] - extLo >= thr && (dir === -1 || loPos > hiPos)) { piv.push([loPos, extLo, "L"]); dir = 1; extHi = H[i]; hiPos = i; }
    }
    if (dir === 1) piv.push([hiPos, extHi, "H"]); else if (dir === -1) piv.push([loPos, extLo, "L"]);
    if (piv.length) { const f = piv[0][0];
      if (piv[0][2] === "H") { let j = 0; for (let k = 0; k <= f; k++) if (L[k] < L[j]) j = k; if (j < f) piv.unshift([j, L[j], "L"]); }
      else { let j = 0; for (let k = 0; k <= f; k++) if (H[k] > H[j]) j = k; if (j < f) piv.unshift([j, H[j], "H"]); } }
    return piv;
  }
  const near = (r, ideal, tol) => Math.max(0, 1 - Math.abs(r - ideal) / tol);
  const pct1 = x => `${(x * 100).toFixed(1)}%`;
  function impulse(p, sign) {
    const x = p.map(v => sign * v), w = {}; for (let i = 0; i < x.length - 1; i++) w[i + 1] = x[i + 1] - x[i];
    if (!(w[1] > 0)) return null;
    const notes = [], fits = [];
    if (2 in w) { if (x[2] <= x[0]) return null; const r = -w[2] / w[1];
      fits.push(Math.max(near(r, 0.618, 0.3), near(r, 0.5, 0.25))); notes.push(`W2 retrace ${pct1(r)} of W1`); }
    if (3 in w) { if (x[3] <= x[1]) return null; const r = w[3] / w[1];
      fits.push(Math.max(near(r, 1.618, 0.8), near(r, 2.618, 0.8), near(r, 1.0, 0.3) * 0.6)); notes.push(`W3 = ${r.toFixed(2)} x W1`); }
    if (4 in w) { if (x[4] <= x[1]) return null; const r = -w[4] / w[3];
      fits.push(Math.max(near(r, 0.382, 0.2), near(r, 0.236, 0.15))); notes.push(`W4 retrace ${pct1(r)} of W3`); }
    if (5 in w) { if (w[5] <= 0) return null; if (w[3] < w[1] && w[3] < w[5]) return null; const r = w[5] / w[1];
      fits.push(Math.max(near(r, 1.0, 0.4), near(r, 0.618, 0.3), near(r, 1.618, 0.5))); notes.push(`W5 = ${r.toFixed(2)} x W1`); }
    return [fits.length ? mean(fits) : 0.5, notes];
  }
  function abc(p, sign) {
    const x = p.map(v => sign * v), a = x[0] - x[1]; if (a <= 0) return null;
    const notes = [], fits = [];
    if (x.length > 2) { const bb = x[2] - x[1]; if (bb <= 0 || bb >= a * 1.382) return null; const r = bb / a;
      fits.push(Math.max(near(r, 0.5, 0.2), near(r, 0.618, 0.25), near(r, 0.786, 0.2))); notes.push(`B retrace ${pct1(r)} of A`); }
    if (x.length > 3) { const cc = x[2] - x[3]; if (cc <= 0) return null; const r = cc / a;
      fits.push(Math.max(near(r, 1.0, 0.4), near(r, 1.618, 0.5), near(r, 0.618, 0.25))); notes.push(`C = ${r.toFixed(2)} x A`); }
    return [fits.length ? mean(fits) : 0.5, notes];
  }
  function targets(p, s, phase) {
    const w1 = p.length > 1 ? Math.abs(p[1] - p[0]) : 0; let t, inv;
    if (phase === "W2") { t = { "W2 50%": p[1] - s * 0.5 * w1, "W2 61.8%": p[1] - s * 0.618 * w1 }; inv = p[0]; }
    else if (phase === "W3") { t = { "W3 1.618": p[2] + s * 1.618 * w1, "W3 2.618": p[2] + s * 2.618 * w1 }; inv = p[2]; }
    else if (phase === "W4") { const w3 = Math.abs(p[3] - p[2]); t = { "W4 23.6%": p[3] - s * 0.236 * w3, "W4 38.2%": p[3] - s * 0.382 * w3 }; inv = p[1]; }
    else if (phase === "W5") { t = { "W5 = W1": p[4] + s * w1, "W5 0.618 x (W1..W3)": p[4] + s * 0.618 * Math.abs(p[3] - p[0]) }; inv = p[4]; }
    else { const span = Math.abs(p[5] - p[0]);
      t = { "ABC 38.2%": p[5] - s * 0.382 * span, "ABC 50%": p[5] - s * 0.5 * span, "ABC 61.8%": p[5] - s * 0.618 * span };
      if (p.length >= 8) { const a = Math.abs(p[6] - p[5]); t["C = A"] = p[7] - s * a; t["C = 1.618 A"] = p[7] - s * 1.618 * a; }
      inv = p[5]; }
    return [t, inv];
  }
  const PHASES = [[3, "W2", "impulse"], [4, "W3", "impulse"], [5, "W4", "impulse"], [6, "W5", "impulse"], [7, "A", "abc"], [8, "B", "abc"], [9, "C", "abc"]];
  const EXPECT = {
    W2: "correction of wave 1, then wave 3 in the trend direction", W3: "strongest leg in the trend direction",
    W4: "sideways/counter-trend pullback, then a final wave 5", W5: "final push; watch for exhaustion and an A-B-C correction",
    A: "first leg of a correction against the prior impulse", B: "counter-move inside the correction (often a trap)",
    C: "final leg of the correction; the prior trend may resume after it" };
  function countWaves(b) {
    const a = last(atr(b)), price = last(b.c), counts = [];
    for (const [degree, mult] of DEGREES) {
      const piv = zigzag(b, a * mult);
      for (const [n, phase, kind] of PHASES) {
        if (piv.length < n) continue;
        const seg = piv.slice(-n), prices = seg.map(x => x[1]), sign = seg[0][2] === "L" ? 1 : -1;
        let res;
        if (kind === "impulse") res = impulse(prices, sign);
        else { const imp = impulse(prices.slice(0, 6), sign), ab = abc(prices.slice(5), sign);
          res = imp && ab ? [(imp[0] + ab[0]) / 2, [...imp[1], ...ab[1]]] : null; }
        if (!res) continue;
        const score = res[0] * (0.6 + 0.4 * Math.min(n, 6) / 6);
        const [t, inv] = targets(prices, sign, kind === "impulse" ? phase : "ABC");
        const trend = sign === 1 ? "up" : "down", nowDir = ["W3", "W5", "B"].includes(phase) ? sign : -sign;
        const labels = ["0", "1", "2", "3", "4", "5", "A", "B", "C"].slice(0, n);
        counts.push({ degree, trend, current_wave: phase,
          pattern: (kind === "impulse" ? "Impulse" : "Impulse + ABC correction") + ` (${trend})`,
          expectation: EXPECT[phase], next_bias: nowDir === 1 ? "up" : "down",
          confidence_pct: Math.round(score * 1000) / 10, fib_notes: res[1], targets: t,
          targets_reached: Object.entries(t).filter(([, v]) => (v - price) * nowDir <= 0).map(([k]) => k),
          invalidation: inv, pivots: seg.map((x, i) => ({ date: b.dates[x[0]], price: x[1], label: labels[i] })) });
      }
    }
    return counts.sort((x, y) => y.confidence_pct - x.confidence_pct);
  }
  function elliott(b, maxAlt = 2) {
    const counts = countWaves(b);
    if (!counts.length) return { primary: null, alternates: [], bias_score: 0, note: "No count satisfies the Elliott rules on the current swings." };
    const p = counts[0], seen = new Set([`${p.degree}|${p.current_wave}|${p.trend}`]), alts = [];
    for (const c of counts.slice(1)) { const k = `${c.degree}|${c.current_wave}|${c.trend}`;
      if (!seen.has(k) && alts.length < maxAlt) { alts.push(c); seen.add(k); } }
    const dir = (["W3", "W5", "B"].includes(p.current_wave) ? 1 : -1) * (p.trend === "up" ? 1 : -1);
    return { primary: p, alternates: alts, bias_score: Math.round(dir * p.confidence_pct * 10) / 10 };
  }
  const sliceBars = (b, end) => ({ dates: b.dates.slice(0, end), o: b.o.slice(0, end), h: b.h.slice(0, end), l: b.l.slice(0, end), c: b.c.slice(0, end), v: b.v.slice(0, end) });
  function elliottBacktest(b, horizon = 21, step = 5, minBars = 250, maxSamples = 100) {
    const ends = []; for (let t = minBars; t < b.c.length - horizon; t += step) ends.push(t);
    let hits = 0, n = 0; const byWave = {};
    for (const t of ends.slice(-maxSamples)) {
      const r = elliott(sliceBars(b, t + 1)); if (!r.primary || !r.bias_score) continue;
      const right = (b.c[t + horizon] > b.c[t]) === (r.bias_score > 0);
      hits += right; n++; const w = byWave[r.primary.current_wave] ||= [0, 0]; w[0] += right; w[1]++;
    }
    if (!n) return { samples: 0 };
    return { samples: n, horizon_days: horizon, direction_hit_rate_pct: Math.round(hits / n * 1000) / 10,
      by_wave: Object.fromEntries(Object.entries(byWave).map(([k, v]) => [k, { n: v[1], hit_rate_pct: Math.round(v[0] / v[1] * 1000) / 10 }])) };
  }

  // ---------- SMC ----------
  function swings(b, len = 5) {
    const sh = [], sl = [];
    for (let i = len; i < b.c.length - len; i++) {
      if (b.h[i] === maxOf(b.h, i - len, i + len + 1) && (!sh.length || i - last(sh)[0] > len)) sh.push([i, b.h[i], i + len]);
      if (b.l[i] === minOf(b.l, i - len, i + len + 1) && (!sl.length || i - last(sl)[0] > len)) sl.push([i, b.l[i], i + len]);
    }
    return [sh, sl];
  }
  function orderBlock(b, start, end, bull) {
    let origin = start;
    for (let j = start; j <= end; j++) if (bull ? b.l[j] < b.l[origin] : b.h[j] > b.h[origin]) origin = j;
    for (let j = origin; j > Math.max(origin - 10, -1); j--) if (bull ? b.c[j] < b.o[j] : b.c[j] > b.o[j]) return j;
    return origin;
  }
  function structure(b, len = 5) {
    const [sh, sl] = swings(b, len), events = [], obs = []; let trend = 0, hi = 0, lo = 0, lastHi = null, lastLo = null;
    for (let t = 0; t < b.c.length; t++) {
      while (hi < sh.length && sh[hi][2] <= t) lastHi = sh[hi++];
      while (lo < sl.length && sl[lo][2] <= t) lastLo = sl[lo++];
      if (lastHi && b.c[t] > lastHi[1]) {
        events.push({ pos: t, type: trend === -1 ? "CHoCH" : "BOS", direction: "bullish", level: lastHi[1], swing_pos: lastHi[0] });
        const j = orderBlock(b, lastHi[0], t, true); obs.push({ pos: j, formed: t, direction: "bullish", bottom: b.l[j], top: b.h[j] });
        trend = 1; lastHi = null;
      } else if (lastLo && b.c[t] < lastLo[1]) {
        events.push({ pos: t, type: trend === 1 ? "CHoCH" : "BOS", direction: "bearish", level: lastLo[1], swing_pos: lastLo[0] });
        const j = orderBlock(b, lastLo[0], t, false); obs.push({ pos: j, formed: t, direction: "bearish", bottom: b.l[j], top: b.h[j] });
        trend = -1; lastLo = null;
      }
    }
    return { events, obs, trend, sh, sl };
  }
  function obStatus(b, ob) {
    const s = ob.formed + 1, n = b.c.length; const any = f => { for (let i = s; i < n; i++) if (f(i)) return true; return false; };
    if (ob.direction === "bullish") { if (any(i => b.c[i] < ob.bottom)) return "broken"; return any(i => b.l[i] <= ob.top) ? "mitigated" : "fresh"; }
    if (any(i => b.c[i] > ob.top)) return "broken"; return any(i => b.h[i] >= ob.bottom) ? "mitigated" : "fresh";
  }
  function fairValueGaps(b, minAtr = 0.25, lookback = 150) {
    const a = atr(b), n = b.c.length, gaps = [];
    for (let i = Math.max(2, n - lookback); i < n; i++) {
      if (b.l[i] - b.h[i - 2] > minAtr * a[i]) gaps.push({ pos: i - 1, direction: "bullish", bottom: b.h[i - 2], top: b.l[i] });
      else if (b.l[i - 2] - b.h[i] > minAtr * a[i]) gaps.push({ pos: i - 1, direction: "bearish", bottom: b.h[i], top: b.l[i - 2] });
    }
    for (const g of gaps) { let filled = false, touched = false;
      for (let i = g.pos + 2; i < n; i++) {
        if (g.direction === "bullish") { if (b.l[i] <= g.bottom) filled = true; if (b.l[i] < g.top) touched = true; }
        else { if (b.h[i] >= g.top) filled = true; if (b.h[i] > g.bottom) touched = true; } }
      g.status = filled ? "filled" : touched ? "partial" : "open"; }
    return gaps;
  }
  function liquidity(b, sh, sl, tolAtr = 0.15, lookback = 150) {
    const a = last(atr(b)), n = b.c.length, pools = [], sweeps = [];
    for (const [pts0, side] of [[sh, "buy-side"], [sl, "sell-side"]]) {
      const pts = pts0.filter(p => p[0] >= n - lookback);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        if (Math.abs(pts[i][1] - pts[j][1]) > tolAtr * a) continue;
        const level = side === "buy-side" ? Math.max(pts[i][1], pts[j][1]) : Math.min(pts[i][1], pts[j][1]);
        let taken = false; for (let k = pts[j][0] + 1; k < n; k++) if (side === "buy-side" ? b.h[k] > level : b.l[k] < level) { taken = true; break; }
        if (!taken) pools.push({ side, level, touches: 2, pos: pts[j][0] });
      }
    }
    for (const [pts, side] of [[sh, "buy-side"], [sl, "sell-side"]]) for (const [, level, conf] of pts)
      for (let t = Math.max(conf, n - 20); t < n; t++) {
        if (side === "buy-side" && b.h[t] > level && b.c[t] < level) { sweeps.push({ pos: t, side, level }); break; }
        if (side === "sell-side" && b.l[t] < level && b.c[t] > level) { sweeps.push({ pos: t, side, level }); break; } }
    const merged = [];
    for (const p of pools.sort((x, y) => x.level - y.level)) { const m = last(merged);
      if (m && m.side === p.side && Math.abs(m.level - p.level) <= tolAtr * a) m.touches++; else merged.push(p); }
    const uniq = new Map(); for (const s of sweeps) uniq.set(`${s.pos}|${s.side}|${s.level.toFixed(6)}`, s);
    return [merged, [...uniq.values()].sort((x, y) => x.pos - y.pos)];
  }
  function premiumDiscount(b, sh, sl) {
    if (!sh.length || !sl.length) return {};
    const start = Math.min(last(sh)[0], last(sl)[0]), hi = maxOf(b.h, start), lo = minOf(b.l, start), price = last(b.c);
    if (hi <= lo) return {};
    const pos = (price - lo) / (hi - lo) * 100, rng = hi - lo;
    return { range_high: hi, range_low: lo, equilibrium: lo + rng / 2, position_pct: pos,
      zone: pos > 55 ? "premium" : pos < 45 ? "discount" : "equilibrium",
      ote_long: [hi - 0.79 * rng, hi - 0.62 * rng], ote_short: [lo + 0.62 * rng, lo + 0.79 * rng] };
  }
  function forwardStats(c, positions, horizons = { "1m": 21, "3m": 63 }) {
    const out = {};
    for (const [k, h] of Object.entries(horizons)) {
      const v = positions.filter(p => p + h < c.length).map(p => (c[p + h] / c[p] - 1) * 100);
      if (v.length) out[k] = { n: v.length, median_pct: median(v), up_pct: v.filter(x => x > 0).length / v.length * 100 };
    }
    return out;
  }
  function smc(b, len = 5) {
    const { events, obs, trend, sh, sl } = structure(b, len), price = last(b.c), n = b.c.length, date = p => b.dates[p];
    obs.forEach(o => { o.status = obStatus(b, o); });
    const active = obs.filter(o => o.status !== "broken");
    const demand = active.filter(o => o.direction === "bullish" && o.top <= price * 1.001).sort((x, y) => y.top - x.top).slice(0, 3);
    const supply = active.filter(o => o.direction === "bearish" && o.bottom >= price * 0.999).sort((x, y) => x.bottom - y.bottom).slice(0, 3);
    const inside = active.filter(o => o.bottom <= price && price <= o.top);
    const gaps = fairValueGaps(b).filter(g => g.status !== "filled").sort((x, y) => Math.abs((x.top + x.bottom) / 2 - price) - Math.abs((y.top + y.bottom) / 2 - price)).slice(0, 4);
    const [pools, sweeps] = liquidity(b, sh, sl);
    const pdz = premiumDiscount(b, sh, sl);
    let score = 0; const lastEv = last(events);
    if (lastEv) { const d = lastEv.direction === "bullish" ? 1 : -1; score += d * (lastEv.type === "BOS" ? 60 : 45);
      if (pdz.zone === (d === 1 ? "discount" : "premium")) score += d * 20; else if (pdz.zone === (d === 1 ? "premium" : "discount")) score -= d * 10; }
    for (const s of sweeps.filter(s => s.pos >= n - 5)) score += s.side === "sell-side" ? 15 : -15;
    for (const o of inside) score += o.direction === "bullish" ? 15 : -15;
    score = clip(score, -100, 100);
    const groups = {}; for (const e of events) (groups[`${e.direction} ${e.type}`] ||= []).push(e.pos);
    const history = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, forwardStats(b.c, v)]));
    let reason = null;
    if (lastEv) { const name = `${lastEv.direction} ${lastEv.type}`, h = (history[name] || {})["1m"];
      if (h) reason = `After the ${h.n} past ${name} events on this chart, the next month's median move was ${h.median_pct >= 0 ? "+" : ""}${h.median_pct.toFixed(1)}% and price was higher ${h.up_pct.toFixed(0)}% of the time.`; }
    const fmtOb = o => ({ date: date(o.pos), formed: date(o.formed), direction: o.direction, bottom: o.bottom, top: o.top, status: o.status });
    return { trend: trend === 1 ? "bullish" : trend === -1 ? "bearish" : "undefined",
      last_event: lastEv ? { type: lastEv.type, direction: lastEv.direction, level: lastEv.level, date: date(lastEv.pos) } : null,
      events: events.slice(-8).map(e => ({ type: e.type, direction: e.direction, level: e.level, date: date(e.pos), swing_date: date(e.swing_pos) })),
      demand_zones: demand.map(fmtOb), supply_zones: supply.map(fmtOb), price_in_order_block: inside.map(fmtOb),
      fair_value_gaps: gaps.map(g => ({ date: date(g.pos), direction: g.direction, bottom: g.bottom, top: g.top, status: g.status })),
      buy_side_liquidity: pools.filter(p => p.side === "buy-side" && p.level > price).sort((x, y) => x.level - y.level).slice(0, 2).map(p => ({ level: p.level, touches: p.touches })),
      sell_side_liquidity: pools.filter(p => p.side === "sell-side" && p.level < price).sort((x, y) => y.level - x.level).slice(0, 2).map(p => ({ level: p.level, touches: p.touches })),
      recent_sweeps: sweeps.slice(-3).map(s => ({ date: date(s.pos), side: s.side, level: s.level })),
      premium_discount: pdz, event_history: history, reason, bias_score: Math.round(score * 10) / 10 };
  }

  // ---------- history context ----------
  function context(b) {
    const c = b.c, n = c.length, H = { "1m": 21, "3m": 63 };
    const fwd = Object.fromEntries(Object.entries(H).map(([k, h]) => [k, c.map((x, i) => i + h < n ? (c[i + h] / x - 1) * 100 : NaNv)]));
    const base = Object.fromEntries(Object.entries(fwd).map(([k, v]) => { const f = v.filter(isNum);
      return [k, { median_pct: median(f), up_pct: f.filter(x => x > 0).length / f.length * 100, n: f.length }]; }));
    const lr = c.map((x, i) => i ? Math.log(x / c[i - 1]) : NaNv);
    const lo63 = rolling(b.l, 63, minOf), hi63 = rolling(b.h, 63, maxOf);
    const s50 = sma(c, 50), s200 = sma(c, 200), hist = macdParts(c).hist;
    const series = {
      rsi14: ["RSI 14", rsi(c)],
      dist_sma50_pct: ["Price vs SMA 50 (%)", c.map((x, i) => (x / s50[i] - 1) * 100)],
      dist_sma200_pct: ["Price vs SMA 200 (%)", c.map((x, i) => (x / s200[i] - 1) * 100)],
      momentum_3m_pct: ["3-month return (%)", shiftRatio(c, 63).map(x => x * 100)],
      macd_hist_pct: ["MACD histogram (% of price)", hist.map((x, i) => x / c[i] * 100)],
      volatility_20d_pct: ["20-day volatility (ann. %)", rolling(lr, 20, w => std(w)).map(x => x * Math.sqrt(252) * 100)],
      drawdown_52w_pct: ["Drop from 52-week high (%)", rolling(c, 252, maxOf, 60).map((m, i) => (c[i] / m - 1) * 100)],
      range_pos_3m_pct: ["Position in 3-month range (%)", c.map((x, i) => (x - lo63[i]) / (hi63[i] - lo63[i]) * 100)],
    };
    if (b.h.some((x, i) => x !== b.l[i])) series.adx14 = ["ADX 14 (trend strength)", adx(b)];
    if (b.v.filter(x => x > 0).length / n > 0.8) { const va = sma(b.v, 50); series.volume_ratio = ["Volume vs 50-day avg (x)", b.v.map((x, i) => x / va[i])]; }
    const years = Math.round(n / 252 * 10) / 10, out = { lookback_years: years, base, parameters: {} };
    const describe = (key, p) => { let lvl = p >= 90 ? "unusually high" : p >= 70 ? "high" : p > 30 ? "typical" : p > 10 ? "low" : "unusually low";
      if (key === "drawdown_52w_pct") lvl = { "unusually high": "at/near the 52-week high", high: "close to the 52-week high",
        typical: "a typical distance from the high", low: "a deep pullback", "unusually low": "one of the deepest pullbacks" }[lvl];
      return lvl; };
    const read = (e, k) => k < 30 ? "too few past cases" : e >= 8 ? "historically a tailwind" : e >= 4 ? "mild tailwind"
      : e <= -8 ? "historically a headwind" : e <= -4 ? "mild headwind" : "no clear edge";
    const f2 = x => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const [key, [label, s]] of Object.entries(series)) {
      const idx = s.map((x, i) => i).filter(i => isNum(s[i]));
      if (idx.length < 120 || !isNum(last(s))) continue;
      const vals = idx.map(i => s[i]), now = last(s);
      const sorted = [...vals].sort((x, y) => x - y);
      const rankPct = x => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
        let up = lo; while (up < sorted.length && sorted[up] === x) up++; return ((lo + up + 1) / 2) / sorted.length * 100; };
      const today = vals.filter(x => x < now).length / vals.length * 100;
      const analog = idx.slice(0, -1).filter(i => Math.abs(rankPct(s[i]) - today) <= 10);
      const stats = forwardStats(c, analog);
      const one = stats["1m"], edge = one ? one.up_pct - base["1m"].up_pct : 0, r = read(edge, one ? one.n : 0);
      const lo = quantile(vals, 0.1), hi = quantile(vals, 0.9);
      let reason = `${label} ${f2(now)} is ${describe(key, today)} (higher than ${today.toFixed(0)}% of the last ${years}y; usual range ${f2(lo)} to ${f2(hi)}).`;
      if (one) reason += ` On ${one.n} similar past days the next month's median move was ${one.median_pct >= 0 ? "+" : ""}${one.median_pct.toFixed(1)}%, up ${one.up_pct.toFixed(0)}% of the time vs ${base["1m"].up_pct.toFixed(0)}% on all days: ${r}.`;
      out.parameters[key] = { label, value: now, percentile: today, p10: lo, p90: hi, median: median(vals), forward: stats, edge_up_pct: edge, read: r, reason };
    }
    return out;
  }

  // ---------- forecast ----------
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function monteCarlo(c, horizons = { "1m": 21, "3m": 63, "6m": 126 }, paths = 4000, seed = 42, shrink = 0.5) {
    const lr = c.slice(1).map((x, i) => Math.log(x / c[i])).slice(-504), m = mean(lr), resid = lr.map(x => x - m), mu = m * (1 - shrink);
    const rnd = mulberry32(seed), price = last(c), out = {};
    for (const [k, days] of Object.entries(horizons)) {
      const end = new Float64Array(paths);
      for (let p = 0; p < paths; p++) { let s = 0; for (let d = 0; d < days; d++) s += resid[(rnd() * resid.length) | 0]; end[p] = price * Math.exp(s + mu * days); }
      const e = Array.from(end), q = x => quantile(e, x);
      out[k] = { days, p5: q(0.05), p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95),
        prob_up_pct: e.filter(x => x > price).length / paths * 100, expected_return_pct: (mean(e) / price - 1) * 100 };
    }
    return out;
  }
  function walkForward(c, horizon = 21, lookback = 126, step = 5) {
    const lr = c.map(Math.log); let hits = 0, n = 0;
    for (let t = lookback; t < lr.length - horizon; t += step) { const past = lr[t] - lr[t - lookback], fut = lr[t + horizon] - lr[t];
      if (!past || !fut) continue; hits += Math.sign(past) === Math.sign(fut); n++; }
    const sampled = lr.filter((_, i) => i % horizon === 0), d = sampled.slice(1).map((x, i) => x - sampled[i]);
    return { samples: n, trend_following_hit_rate_pct: n ? hits / n * 100 : null, base_rate_up_pct: d.length ? d.filter(x => x > 0).length / d.length * 100 : null };
  }

  // ---------- own prediction model (coefficients from model.json) ----------
  function features(b, market) {
    const c = b.c, h = b.h, l = b.l, v = b.v.map(x => isNum(x) ? x : 0), n = c.length, i = n - 1;
    const sm = k => mean(c.slice(n - k)), lr = c.slice(1).map((x, k) => Math.log(x / c[k]));
    const e12 = ema(c, 12), e26 = ema(c, 26), line = e12.map((x, k) => x - e26[k]), sig = ema(line, 9);
    const r = rsi(c), vavg = mean(v.slice(n - 50));
    const lo63 = minOf(l, n - 63), hi63 = maxOf(h, n - 63);
    const f = {
      ret_5: c[i] / c[i - 5] - 1, ret_21: c[i] / c[i - 21] - 1, ret_63: c[i] / c[i - 63] - 1,
      ret_126: c[i] / c[i - 126] - 1, ret_252: c[i] / c[i - 252] - 1,
      rsi14: r[i] / 100, dist_sma20: c[i] / sm(20) - 1, dist_sma50: c[i] / sm(50) - 1, dist_sma200: c[i] / sm(200) - 1,
      sma50_vs_200: sm(50) / sm(200) - 1,
      vol_20: std(lr.slice(-20)) * Math.sqrt(252), vol_63: std(lr.slice(-63)) * Math.sqrt(252),
      drawdown_252: c[i] / maxOf(c, n - 252) - 1,
      range_pos_63: hi63 > lo63 ? (c[i] - lo63) / (hi63 - lo63) : 0.5,
      macd_hist_pct: (line[i] - sig[i]) / c[i], atr_pct: last(atr(b)) / c[i],
      volume_ratio: vavg > 0 ? clip(v[i] / vavg, 0, 5) : 1, is_th: market === "TH" ? 1 : 0,
    };
    return n > 252 ? f : null;
  }
  function predict(model, b, market) {
    const f = features(b, market); if (!model || !f) return null;
    const x = model.features.map(k => f[k]); if (x.some(z => !isNum(z))) return null;
    const z = x.map((v, k) => clip((v - model.mean[k]) / model.std[k], -model.clip, model.clip));
    const wl = model.logistic, wr = model.ridge;
    let logit = wl[0], rr = wr[0]; z.forEach((v, k) => { logit += v * wl[k + 1]; rr += v * wr[k + 1]; });
    const drivers = model.features.map((k, j) => ({ feature: k, label: model.labels[k], value: x[j], effect: z[j] * wl[j + 1] }))
      .sort((p, q) => Math.abs(q.effect) - Math.abs(p.effect)).slice(0, 6);
    return { beat_prob_pct: 100 / (1 + Math.exp(-logit)), expected_rel_return_pct: (Math.exp(rr) - 1) * 100,
      drivers, horizon_days: model.horizon_days, features: f };
  }
  const modelScore = m => m ? clip((m.beat_prob_pct - 50) * 12, -100, 100) : null;

  function outlook(tech, mc, parts0) {
    const parts = { trend: [tech.trend_score, 0.4], momentum_prob: [(mc["3m"].prob_up_pct - 50) * 2, 0.2] };
    for (const [k, v, w] of parts0) if (isNum(v)) parts[k] = [v, w];
    const tw = Object.values(parts).reduce((s, [, w]) => s + w, 0);
    const score = Object.values(parts).reduce((s, [v, w]) => s + v * w, 0) / tw;
    const agree = score ? Object.values(parts).filter(([v]) => Math.sign(v) === Math.sign(score)).length / Object.keys(parts).length : 0;
    return { score: Math.round(score * 10) / 10, signal: score >= 25 ? "Bullish" : score <= -25 ? "Bearish" : "Neutral",
      agreement_pct: Math.round(agree * 100), components: Object.fromEntries(Object.entries(parts).map(([k, [v]]) => [k, Math.round(v * 10) / 10])) };
  }

  /** Full analysis in the same shape as the Python report JSON. `snap` = screener row (fundamentals). */
  function analyze(bars, meta = {}, model = null, opts = {}) {
    const market = meta.market || (String(meta.symbol || "").endsWith(".BK") ? "TH" : "US");
    const tech = technical(bars), mc = monteCarlo(bars.c), ew = elliott(bars), sm = smc(bars);
    if (opts.backtest !== false) ew.backtest = elliottBacktest(bars);
    const pred = predict(model, bars, market), snap = meta.snapshot || {};
    const f = snap.fundamental_score, upside = snap.analyst_upside_pct;
    const out = outlook(tech, mc, [["fundamentals", isNum(f) ? (f - 50) * 2 : null, 0.3],
      ["valuation", isNum(upside) ? clip(upside * 2, -100, 100) : null, 0.1],
      ["elliott", ew.bias_score, 0.1], ["smc", sm.bias_score, 0.15], ["model", modelScore(pred), 0.2]]);
    const n = bars.c.length, k = Math.min(500, n), s50 = sma(bars.c, 50), s200 = sma(bars.c, 200);
    const nz = x => isNum(x) ? Math.round(x * 1e4) / 1e4 : null;
    return { symbol: meta.symbol, name: meta.name || meta.symbol, market, asset_type: meta.asset_type || "stock",
      currency: meta.currency, as_of: last(bars.dates), engine: "browser",
      technical: tech, elliott: ew, smc: sm, context: context(bars), forecast: mc, backtest: walkForward(bars.c),
      model: pred, outlook: out,
      chart: { dates: bars.dates.slice(-k), close: bars.c.slice(-k).map(nz), sma50: s50.slice(-k).map(nz), sma200: s200.slice(-k).map(nz) },
      disclaimer: "Statistical and rule-based analysis for education only. Not investment advice; past patterns do not guarantee future prices." };
  }

  /** Decode a published price file: {s, d0, dt:[day gaps], o,h,l,c,v}. */
  function decode(j) {
    const dates = [], d = new Date(`${j.d0}T00:00:00Z`);
    for (const g of j.dt) { d.setUTCDate(d.getUTCDate() + g); dates.push(d.toISOString().slice(0, 10)); }
    return { dates, o: j.o, h: j.h, l: j.l, c: j.c, v: j.v || j.c.map(() => 0) };
  }

  const api = { analyze, decode, technical, elliott, elliottBacktest, smc, context, monteCarlo, walkForward, features, predict,
    zigzag, rsi, sma, ema, atr, adx, outlook, modelScore };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Engine = api;
})(typeof self !== "undefined" ? self : this);
