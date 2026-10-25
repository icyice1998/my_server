/* Machine-learning layer for the Algo Lab: learn a better score than "share of entry rules met".
 *
 * Features (all known at the close of day t): 18 price features of each stock, ranked across all stocks that day
 * (0 = lowest, 1 = highest), 4 market-regime features of the index, and the share of the algorithm's entry rules met.
 * Models: L2 logistic regression (IRLS) and gradient-boosted trees (depth 3, histogram splits, early stopping).
 *
 * Validation is time-ordered and purged: the out-of-sample (OOS) part is the same last 30% of dates as the rules test;
 * training uses only dates whose outcome window ends before the OOS part starts, and the last 20% of those dates
 * (again purged by the horizon) pick the model's settings. The OOS rows are never seen during training.
 */
(function (root) {
  "use strict";
  const S = root.Strategy || (typeof require !== "undefined" ? require("./strategy.js") : null);
  const A = root.Algo || (typeof require !== "undefined" ? require("./algo.js") : null);
  const isNum = x => typeof x === "number" && Number.isFinite(x);

  const gap = n => c => { const m = S.sma(c, n); return c.map((x, t) => (x / m[t] - 1) * 100); };
  const STOCK = [
    ["ret5", "Return 5 days", { ind: "ret", n: 5 }], ["ret21", "Return 1 month", { ind: "ret", n: 21 }],
    ["ret63", "Return 3 months", { ind: "ret", n: 63 }], ["ret126", "Return 6 months", { ind: "ret", n: 126 }],
    ["ret252", "Return 12 months", { ind: "ret", n: 252 }],
    ["mom", "Momentum 12-1 months", c => c.map((x, t) => t >= 252 ? c[t - 21] / c[t - 252] - 1 : NaN)],
    ["vol20", "Volatility 20 days", { ind: "vol", n: 20 }], ["vol63", "Volatility 63 days", { ind: "vol", n: 63 }],
    ["rsi5", "RSI 5", { ind: "rsi", n: 5 }], ["rsi14", "RSI 14", { ind: "rsi", n: 14 }],
    ["gap20", "% vs SMA20", gap(20)], ["gap50", "% vs SMA50", gap(50)], ["gap200", "% vs SMA200", gap(200)],
    ["trend", "SMA50 vs SMA200", c => { const a = S.sma(c, 50), b = S.sma(c, 200); return a.map((x, t) => x / b[t] - 1); }],
    ["dhigh20", "% below 20-day high", { ind: "dhigh", n: 20 }], ["dhigh252", "% below 52-week high", { ind: "dhigh", n: 252 }],
    ["dlow252", "% above 52-week low", { ind: "dlow", n: 252 }], ["macd", "MACD histogram", { ind: "macd" }],
  ];
  const MARKET = [
    ["iret21", "Index return 1 month", x => x.map((v, t) => t >= 21 ? v / x[t - 21] - 1 : NaN)],
    ["iret63", "Index return 3 months", x => x.map((v, t) => t >= 63 ? v / x[t - 63] - 1 : NaN)],
    ["igap200", "Index % vs SMA200", x => { const m = S.sma(x, 200); return x.map((v, t) => v / m[t] - 1); }],
    ["ivol20", "Index volatility", x => S.volatility(x, 20)],
  ];
  const FEATURES = [...STOCK.map(f => ({ key: f[0], label: f[1], kind: "stock" })),
    ...MARKET.map(f => ({ key: f[0], label: f[1], kind: "market" })), { key: "rules", label: "Entry rules met", kind: "rules" }];
  const NF = FEATURES.length, NS = STOCK.length;

  // ---------- features ----------
  function context(P, algo) {
    const C = A.compile(P, algo), market = (algo.eval || {}).label === "up";
    const ser = STOCK.map(([key, , d]) => P.stocks.map((s, i) => typeof d === "function"
      ? ((s._c || (s._c = {}))[`ml_${key}`] ||= d(s.c)) : A.series(P, i, d)));
    const mc = P._ml || (P._ml = {});
    const mkt = MARKET.map(([key, , d]) => mc[key] ||= d(P.idx));
    return { P, C, ser, mkt, market };
  }

  /** Feature rows of every stock on day t (NaN row = no price that day). */
  function featuresAt(ctx, t) {
    const { P, C, ser, mkt, market } = ctx, N = P.stocks.length, X = new Float32Array(N * NF).fill(NaN);
    const live = [];
    for (let i = 0; i < N; i++) if (isNum(P.stocks[i].c[t])) live.push(i);
    const vals = [];
    for (let f = 0; f < NS; f++) {
      vals.length = 0;
      for (const i of live) { const v = ser[f][i][t]; if (isNum(v)) vals.push([v, i]); else X[i * NF + f] = 0.5; }
      vals.sort((a, b) => a[0] - b[0]);
      const m = vals.length;
      for (let k = 0; k < m;) {
        let j = k; while (j < m && vals[j][0] === vals[k][0]) j++;
        const r = m > 1 ? (k + j - 1) / 2 / (m - 1) : 0.5;
        for (let q = k; q < j; q++) X[vals[q][1] * NF + f] = r;
        k = j;
      }
    }
    for (const i of live) {
      for (let f = 0; f < MARKET.length; f++) X[i * NF + NS + f] = market && isNum(mkt[f][t]) ? mkt[f][t] : 0;
      X[i * NF + NF - 1] = C.ruleCount ? C.met(i, t) / C.ruleCount : 0;
    }
    return X;
  }

  /** Feature matrix for the sampled rows of Algo.evaluate (rows come grouped by date). */
  function dataset(ctx, rows) {
    const n = rows.length, X = new Float32Array(n * NF);
    let lastT = -1, F = null;
    for (let r = 0; r < n; r++) {
      const { t, i } = rows[r];
      if (t !== lastT) { F = featuresAt(ctx, t); lastT = t; }
      X.set(F.subarray(i * NF, i * NF + NF), r * NF);
    }
    return X;
  }

  // ---------- statistics ----------
  function auc(score, y, idx) {
    const o = Array.from(idx).sort((a, b) => score[a] - score[b]);
    let pos = 0, neg = 0, sum = 0;
    for (let k = 0; k < o.length;) {
      let j = k, p = 0; while (j < o.length && score[o[j]] === score[o[k]]) { p += y[o[j]]; j++; }
      sum += p * ((k + j - 1) / 2 + 1); pos += p; neg += j - k - p; k = j;
    }
    return pos && neg ? (sum - pos * (pos + 1) / 2) / (pos * neg) : NaN;
  }
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- logistic regression (L2, IRLS) ----------
  function fitLogistic(X, y, idx, lambda) {
    const p = NF + 1, mean = new Float64Array(NF), sd = new Float64Array(NF);
    for (const r of idx) for (let f = 0; f < NF; f++) mean[f] += X[r * NF + f];
    for (let f = 0; f < NF; f++) mean[f] /= idx.length;
    for (const r of idx) for (let f = 0; f < NF; f++) sd[f] += (X[r * NF + f] - mean[f]) ** 2;
    for (let f = 0; f < NF; f++) sd[f] = Math.sqrt(sd[f] / idx.length) || 1;
    const w = new Float64Array(p), xs = new Float64Array(p); xs[0] = 1;
    for (let it = 0; it < 25; it++) {
      const H = new Float64Array(p * p), g = new Float64Array(p);
      for (const r of idx) {
        let z = w[0];
        for (let f = 0; f < NF; f++) { xs[f + 1] = (X[r * NF + f] - mean[f]) / sd[f]; z += w[f + 1] * xs[f + 1]; }
        const pr = 1 / (1 + Math.exp(-z)), e = pr - y[r], h = Math.max(pr * (1 - pr), 1e-6);
        for (let a = 0; a < p; a++) { g[a] += e * xs[a]; const ha = h * xs[a]; for (let b = a; b < p; b++) H[a * p + b] += ha * xs[b]; }
      }
      for (let a = 1; a < p; a++) { g[a] += lambda * w[a]; H[a * p + a] += lambda; }
      for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) H[a * p + b] = H[b * p + a];
      const d = solve(H, g, p);
      let mx = 0; for (let a = 0; a < p; a++) { w[a] -= d[a]; mx = Math.max(mx, Math.abs(d[a])); }
      if (mx < 1e-6) break;
    }
    const predict = (row, o = 0) => { let z = w[0]; for (let f = 0; f < NF; f++) z += w[f + 1] * (row[o + f] - mean[f]) / sd[f]; return z; };
    const total = w.slice(1).reduce((a, v) => a + Math.abs(v), 0) || 1;
    // contribution of each feature to the log-odds, relative to an average sample
    const explain = (row, o = 0) => Array.from({ length: NF }, (_, f) => w[f + 1] * (row[o + f] - mean[f]) / sd[f]);
    return { kind: "logistic", lambda, predict, explain, coef: Array.from(w.slice(1)),
      importance: Array.from(w.slice(1), v => Math.abs(v) / total) };
  }
  function solve(H, g, p) {   // Gaussian elimination with partial pivoting
    const M = Array.from({ length: p }, (_, a) => [...H.slice(a * p, a * p + p), g[a]]);
    for (let c = 0; c < p; c++) {
      let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c] || 1e-12;
      for (let r = c + 1; r < p; r++) { const k = M[r][c] / d; if (k) for (let q = c; q <= p; q++) M[r][q] -= k * M[c][q]; }
    }
    const x = new Float64Array(p);
    for (let r = p - 1; r >= 0; r--) { let s = M[r][p]; for (let q = r + 1; q < p; q++) s -= M[r][q] * x[q]; x[r] = s / (M[r][r] || 1e-12); }
    return x;
  }

  // ---------- gradient-boosted trees (logloss, histogram splits) ----------
  const GBM = { depth: 3, rate: 0.1, maxTrees: 200, subsample: 0.5, lambda: 1, minHess: 50, bins: 32, patience: 40 };

  function binner(X, idx) {
    const edges = [], step = Math.max(1, Math.floor(idx.length / 20000));
    for (let f = 0; f < NF; f++) {
      const v = []; for (let k = 0; k < idx.length; k += step) v.push(X[idx[k] * NF + f]);
      v.sort((a, b) => a - b);
      const e = [];
      for (let b = 1; b < GBM.bins; b++) { const q = v[Math.floor(b * v.length / GBM.bins)]; if (!e.length || q > e.at(-1)) e.push(q); }
      edges.push(Float64Array.from(e));
    }
    const bin = (f, x) => { const e = edges[f]; let lo = 0, hi = e.length; while (lo < hi) { const m = (lo + hi) >> 1; if (x > e[m]) lo = m + 1; else hi = m; } return lo; };
    return { edges, bin };
  }

  function binize(X, n, B) {
    const Z = new Uint8Array(n * NF);
    for (let r = 0; r < n; r++) for (let f = 0; f < NF; f++) Z[r * NF + f] = B.bin(f, X[r * NF + f]);
    return Z;
  }

  function growTree(Z, rows, g, h, gainBy) {
    const nb = GBM.bins, L = GBM.lambda, tree = [{}], slot = new Int32Array(rows.length);   // slot = active leaf of each row
    let active = [0];
    for (let d = 0; d < GBM.depth && active.length; d++) {
      const hist = new Float64Array(active.length * NF * nb * 2), GH = new Float64Array(active.length * 2);
      for (let k = 0; k < rows.length; k++) {
        const a = slot[k]; if (a < 0) continue;
        const r = rows[k], base = a * NF * nb * 2, gr = g[r], hr = h[r], zo = r * NF;
        GH[a * 2] += gr; GH[a * 2 + 1] += hr;
        for (let f = 0; f < NF; f++) { const o = base + (f * nb + Z[zo + f]) * 2; hist[o] += gr; hist[o + 1] += hr; }
      }
      const next = [], map = new Int32Array(active.length * 2).fill(-1);
      active.forEach((node, a) => {
        const G = GH[a * 2], H = GH[a * 2 + 1], parent = G * G / (H + L);
        tree[node].G = G; tree[node].H = H;
        let best = 0, bf = -1, bb = -1;
        for (let f = 0; f < NF; f++) {
          let gl = 0, hl = 0;
          for (let b = 0; b < nb - 1; b++) {
            const o = ((a * NF + f) * nb + b) * 2; gl += hist[o]; hl += hist[o + 1];
            const hr = H - hl;
            if (hl < GBM.minHess || hr < GBM.minHess) continue;
            const gain = gl * gl / (hl + L) + (G - gl) * (G - gl) / (hr + L) - parent;
            if (gain > best) { best = gain; bf = f; bb = b; }
          }
        }
        if (bf < 0) return;
        gainBy[bf] += best;
        const li = tree.push({}) - 1, ri = tree.push({}) - 1;
        Object.assign(tree[node], { f: bf, b: bb, l: li, r: ri });
        map[a * 2] = next.push(li) - 1; map[a * 2 + 1] = next.push(ri) - 1;
      });
      for (let k = 0; k < rows.length; k++) {
        const a = slot[k]; if (a < 0) continue;
        const nd = tree[active[a]];
        slot[k] = nd.f === undefined ? -1 : map[a * 2 + (Z[rows[k] * NF + nd.f] <= nd.b ? 0 : 1)];
      }
      active = next;
    }
    // leaves of the last level still need their sums
    if (active.length) {
      const GH = new Float64Array(active.length * 2);
      for (let k = 0; k < rows.length; k++) { const a = slot[k]; if (a >= 0) { GH[a * 2] += g[rows[k]]; GH[a * 2 + 1] += h[rows[k]]; } }
      active.forEach((node, a) => { tree[node].G = GH[a * 2]; tree[node].H = GH[a * 2 + 1]; });
    }
    for (const nd of tree) if (nd.f === undefined) nd.v = -GBM.rate * (nd.G || 0) / ((nd.H || 0) + L);
    return tree;
  }
  const treeOut = (tree, Z, r) => { let n = tree[0]; while (n.f !== undefined) n = tree[Z[r * NF + n.f] <= n.b ? n.l : n.r]; return n.v; };

  /** Boost on `fit` rows; with `val` rows stop when validation AUC stops improving. With `rounds` fit exactly that many. */
  async function fitGbm(X, Zall, y, fit, val, opt = {}) {
    const n = y.length, F = new Float64Array(n), g = new Float64Array(n), h = new Float64Array(n), rand = rng(42);
    const prior = fit.reduce((a, r) => a + y[r], 0) / fit.length, f0 = Math.log(prior / (1 - prior));
    F.fill(f0);
    const trees = [], gainBy = new Float64Array(NF), max = opt.rounds || GBM.maxTrees;
    let bestAuc = -1, bestN = 0;
    const idxVal = val ? Int32Array.from(val) : null;
    for (let m = 0; m < max; m++) {
      for (const r of fit) { const p = 1 / (1 + Math.exp(-F[r])); g[r] = p - y[r]; h[r] = p * (1 - p); }
      const rows = fit.filter(() => rand() < GBM.subsample);
      const tree = growTree(Zall, rows, g, h, gainBy);
      trees.push(tree);
      for (const r of fit) F[r] += treeOut(tree, Zall, r);
      if (val) for (const r of val) F[r] += treeOut(tree, Zall, r);
      if (val && (m + 1) % 10 === 0) {
        const a = auc(F, y, idxVal);
        if (a > bestAuc) { bestAuc = a; bestN = m + 1; } else if (m + 1 - bestN >= GBM.patience) break;
      }
      if (opt.onTree && (m + 1) % 10 === 0) await opt.onTree(m + 1, max);
    }
    const nT = val ? Math.max(bestN, 10) : trees.length;
    const total = gainBy.reduce((a, b) => a + b, 0) || 1;
    return { kind: "gbm", trees: trees.slice(0, nT), f0, rounds: nT, valAuc: bestAuc, importance: Array.from(gainBy, v => v / total) };
  }
  function gbmPredictor(model, B) {
    const z = new Uint8Array(NF);
    return (row, o = 0) => {
      for (let f = 0; f < NF; f++) z[f] = B.bin(f, row[o + f]);
      let s = model.f0;
      for (const tree of model.trees) s += treeOut(tree, z, 0);
      return s;
    };
  }

  // ---------- training pipeline ----------
  const tick = () => new Promise(r => setTimeout(r, 0));

  /**
   * Train both models on the sampled rows of an Algo.evaluate(..., { keepRows: true }) result.
   * opt: { topPct (share of stocks bought each day by the ML decision), onProgress(text) }
   */
  async function train(P, algo, ev, opt = {}) {
    const say = opt.onProgress || (() => {}), topPct = opt.topPct ?? 20, H = ev.eval.horizon;
    const rows = ev.sample, n = rows.length;
    say("Building features…"); await tick();
    const ctx = context(P, algo), X = dataset(ctx, rows);
    const y = Uint8Array.from(rows, r => r.label), ts = Int32Array.from(rows, r => r.t);
    const pool = [], test = [];
    rows.forEach((r, k) => { if (r.t >= ev.splitT) test.push(k); else if (r.t < ev.splitT - H) pool.push(k); });
    const poolDates = [...new Set(pool.map(k => ts[k]))];
    const valStart = poolDates[Math.floor(poolDates.length * 0.8)];
    const fit = pool.filter(k => ts[k] < valStart - H), val = pool.filter(k => ts[k] >= valStart);
    if (fit.length < 2000 || val.length < 500 || test.length < 500) throw new Error("Not enough samples to train: use a longer period or sample more often.");

    // logistic: pick the penalty on validation, refit on the whole training pool
    say("Fitting logistic regression…"); await tick();
    let bestL = null;
    for (const lambda of [1, 100, 3000]) {
      const m = fitLogistic(X, y, fit, lambda), s = new Float64Array(n);
      for (const k of val) s[k] = m.predict(X, k * NF);
      const a = auc(s, y, val);
      if (!bestL || a > bestL.valAuc) bestL = { lambda, valAuc: a };
    }
    const logit = fitLogistic(X, y, pool, bestL.lambda); logit.valAuc = bestL.valAuc;

    // boosted trees: fit on the training part, stop when validation AUC stops improving
    const B = binner(X, pool), Z = binize(X, n, B);
    const gbm = await fitGbm(X, Z, y, fit, val, { onTree: async (m, max) => { say(`Boosting trees ${m}/${max} (stops when validation AUC stalls)…`); await tick(); } });
    gbm.predict = gbmPredictor(gbm, B);

    say("Scoring the out-of-sample period…"); await tick();
    const rulesScore = Float64Array.from(rows, r => r.score), fwd = Float64Array.from(rows, r => r.fwd);
    const models = [logit, gbm].map(m => {
      const s = new Float64Array(n);
      for (let k = 0; k < n; k++) s[k] = m.predict(X, k * NF);
      return { ...m, score: s };
    });
    const rulesOOS = ev.outSample;
    const stats = models.map(m => statsFor(m, rows, test, m.kind === "gbm" ? fit : pool, y, fwd, topPct));
    const best = stats[0].valAuc >= stats[1].valAuc ? 0 : 1;
    say("Bootstrapping the AUC gain…"); await tick();
    const boot = bootstrap(models[best].score, rulesScore, y, ts, test);

    // production models for today's ranking: same settings, refit on every labelled row (test period included)
    say("Refitting on all data for today's ranking…"); await tick();
    const all = Array.from(rows.keys());
    const finalLogit = fitLogistic(X, y, all, bestL.lambda);
    let finalPredict = finalLogit.predict;
    if (best === 1) {
      const B2 = binner(X, all), fin = await fitGbm(X, binize(X, n, B2), y, all, null, { rounds: gbm.rounds });
      finalPredict = gbmPredictor(fin, B2);
    }
    return { features: FEATURES.map(f => ({ ...f, off: f.kind === "market" && !ctx.market })), models: stats, best, boot, topPct, rulesOOS, rulesAuc: auc(rulesScore, y, test),
      counts: { fit: fit.length, val: val.length, pool: pool.length, test: test.length }, dates: {
        fit: [P.dates[ts[fit[0]]], P.dates[ts[fit.at(-1)]]], val: [P.dates[ts[val[0]]], P.dates[ts[val.at(-1)]]],
        test: [P.dates[ts[test[0]]], P.dates[ts[test.at(-1)]]] },
      ctx, predictors: models.map(m => m.predict), splitT: ev.splitT, horizon: H, label: ev.eval.label,
      final: { predict: finalPredict, explain: finalLogit.explain }, baseRate: y.reduce((a, b) => a + b, 0) / n };
  }

  /** Decision = top `topPct`% of ML scores on each date. */
  function topDecisions(score, ts, idx, topPct) {
    const dec = new Uint8Array(score.length), byT = new Map();
    for (const k of idx) (byT.get(ts[k]) || byT.set(ts[k], []).get(ts[k])).push(k);
    for (const ks of byT.values()) {
      ks.sort((a, b) => score[b] - score[a]);
      const take = Math.max(1, Math.round(ks.length * topPct / 100));
      for (let q = 0; q < take; q++) dec[ks[q]] = 1;
    }
    return dec;
  }

  function statsFor(m, rows, test, pool, y, fwd, topPct) {
    const ts = Int32Array.from(rows, r => r.t), dec = topDecisions(m.score, ts, test, topPct);
    const pick = a => test.map(k => a[k]);
    const sc = pick(m.score), lab = pick(y), fw = pick(fwd);
    return { kind: m.kind, label: m.kind === "gbm" ? "Gradient-boosted trees" : "Logistic regression",
      detail: m.kind === "gbm" ? `${m.rounds} trees, depth ${GBM.depth}, rate ${GBM.rate}` : `L2 penalty ${m.lambda}`,
      trainAuc: auc(m.score, y, pool), valAuc: m.valAuc, roc: A.roc(sc, lab), confusion: A.confusion(pick(dec), lab, fw),
      deciles: A.deciles(sc, lab, fw), ic: A.spearman(sc, fw), importance: m.importance, coef: m.coef, score: m.score };
  }

  /** Date-block bootstrap of AUC(model) − AUC(rules) on the OOS rows: whole days are resampled (keeps the
   * cross-section together) and become row weights, so each resample is one pass over rows sorted once. */
  function bootstrap(sm, sr, y, ts, test, B = 200) {
    const dayOf = new Map(), day = new Int32Array(test.length);
    test.forEach((k, q) => { if (!dayOf.has(ts[k])) dayOf.set(ts[k], dayOf.size); day[q] = dayOf.get(ts[k]); });
    const order = s => Int32Array.from(test.keys()).sort((a, b) => s[test[a]] - s[test[b]]);
    const o1 = order(sm), o2 = order(sr), D = dayOf.size, cnt = new Float64Array(D), rand = rng(7), diffs = [];
    const wauc = (o, s) => {
      let pos = 0, neg = 0, sum = 0;
      for (let k = 0; k < o.length;) {
        let j = k, wp = 0, wn = 0;
        while (j < o.length && s[test[o[j]]] === s[test[o[k]]]) { const q = o[j], w = cnt[day[q]]; y[test[q]] ? wp += w : wn += w; j++; }
        sum += wp * (neg + wn / 2); pos += wp; neg += wn; k = j;
      }
      return sum / (pos * neg);
    };
    for (let b = 0; b < B; b++) {
      cnt.fill(0); for (let d = 0; d < D; d++) cnt[Math.floor(rand() * D)]++;
      diffs.push(wauc(o1, sm) - wauc(o2, sr));
    }
    diffs.sort((a, b) => a - b);
    return { lo: diffs[Math.floor(0.025 * B)], hi: diffs[Math.floor(0.975 * B)], pWorse: diffs.filter(d => d <= 0).length / B, B };
  }

  /** Portfolio backtest of the OOS period: buy the top `topPct`% by ML score each day (optionally only when the rules pass). */
  function backtestML(P, algo, res, settings, opt = {}) {
    const model = opt.model ?? res.best, predict = res.predictors[model], ctx = res.ctx, topPct = opt.topPct ?? res.topPct;
    const from = res.splitT, T = P.dates.length - 1, N = P.stocks.length;
    const score = [], thr = [];
    for (let t = from; t <= T; t++) {
      const F = featuresAt(ctx, t), s = new Float64Array(N).fill(NaN), live = [];
      for (let i = 0; i < N; i++) if (!Number.isNaN(F[i * NF])) { s[i] = predict(F, i * NF); live.push(s[i]); }
      live.sort((a, b) => b - a);
      score.push(s); thr.push(live.length ? live[Math.max(0, Math.round(live.length * topPct / 100) - 1)] : Infinity);
    }
    const C = ctx.C, filter = opt.mode === "filter";
    const entryFn = (i, t) => { const s = score[t - from]?.[i]; return isNum(s) && s >= thr[t - from] && (!filter || C.entryFn(i, t)); };
    const rankFn = (i, t) => score[t - from]?.[i] ?? NaN;
    const ml = S.backtest(P, { ...settings, entryFn, exitFn: C.exitFn, rankFn }, { from });
    const rules = A.backtestAlgo(P, algo, settings, { from });
    return { ml, rules };
  }

  /** Rank every stock on the latest close with the production model; reasons come from the logistic contributions. */
  function today(P, res, opt = {}) {
    const t = opt.t ?? P.dates.length - 1, F = featuresAt(res.ctx, t), out = [];
    const sig = z => 1 / (1 + Math.exp(-z));
    for (let i = 0; i < P.stocks.length; i++) {
      if (Number.isNaN(F[i * NF])) continue;
      const z = res.final.predict(F, i * NF), c = res.final.explain(F, i * NF);
      const reasons = c.map((v, f) => ({ f, v, x: F[i * NF + f] })).filter(r => !res.features[r.f].off && Math.abs(r.v) > 1e-9)
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 4);
      out.push({ i, sym: P.stocks[i].sym, name: P.stocks[i].name, sector: P.stocks[i].sector, price: P.stocks[i].c[t], z, prob: sig(z), reasons });
    }
    out.sort((a, b) => b.z - a.z);
    out.forEach((r, k) => { r.rank = k + 1; r.pctl = 1 - k / Math.max(1, out.length - 1); });
    return { date: P.dates[t], list: out };
  }

  const api = { FEATURES, GBM, fitGbm, today, binner, binize, train, backtestML, auc, featuresAt, context, fitLogistic, topDecisions };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ML = api;
})(typeof self !== "undefined" ? self : this);
