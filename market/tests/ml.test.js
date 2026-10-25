// node --test tests/ml.test.js   (run from market/)
const test = require("node:test"), assert = require("node:assert");
const S = require("../strategy.js"), A = require("../algo.js"), ML = require("../ml.js");

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

/** Synthetic market where each stock keeps a hidden drift for 120 days, so recent returns predict the next month. */
function panel(stocks = 80, days = 760, seed = 3) {
  const r = rng(seed), closes = [];
  for (let i = 0; i < stocks; i++) {
    let x = 100, mu = 0; const c = [];
    for (let t = 0; t < days; t++) { if (t % 120 === 0) mu = gauss(r) * 0.004; x *= 1 + mu + gauss(r) * 0.012; c.push(x); }
    closes.push(c);
  }
  const index = closes[0].map((_, t) => closes.reduce((a, c) => a + c[t] / c[0], 0) / stocks * 100);
  const dates = index.map((_, t) => new Date(Date.UTC(2020, 0, 1 + t)).toISOString().slice(0, 10));
  return S.prepare({ dates, index, symbols: closes.map((_, i) => `S${i}`), closes, sectors: closes.map((_, i) => `X${i % 8}`),
    names: closes.map((_, i) => `S${i}`) });
}

test("rank AUC matches Algo.roc", () => {
  const r = rng(9), s = Array.from({ length: 500 }, () => Math.round(r() * 20)), y = s.map(v => r() < v / 25 ? 1 : 0);
  assert.ok(Math.abs(ML.auc(s, y, s.map((_, k) => k)) - A.roc(s, y).auc) < 1e-12);
});

test("features use no future prices", () => {
  const P1 = panel(20, 400, 5), P2 = panel(20, 400, 5);
  for (const s of P2.stocks) for (let t = 301; t < 400; t++) s.c[t] *= 1.5 + Math.sin(t);
  const algo = A.PRESETS[0];
  const f1 = ML.featuresAt(ML.context(P1, algo), 300), f2 = ML.featuresAt(ML.context(P2, algo), 300);
  assert.deepStrictEqual(Array.from(f1), Array.from(f2));
});

test("ML finds a real signal the rules miss, judged on unseen dates", async () => {
  const P = panel(), algo = { ...A.PRESETS[3], eval: { horizon: 21, label: "beat", step: 2 } };
  const ev = A.evaluate(P, algo, { keepRows: true });
  const res = await ML.train(P, algo, ev, { topPct: 20 });
  const best = res.models[res.best];
  assert.ok(best.roc.auc > 0.56, `ML test AUC ${best.roc.auc}`);
  assert.ok(best.roc.auc > res.rulesAuc + 0.03, `ML ${best.roc.auc} vs rules ${res.rulesAuc}`);
  assert.ok(res.boot.lo > 0, "bootstrap interval of the gain is above zero");
  assert.ok(res.dates.fit[1] < res.dates.val[0] && res.dates.val[1] < res.dates.test[0], "train < validation < test in time");
  const bt = ML.backtestML(P, algo, res, { capital: 100000 }, {});
  assert.strictEqual(bt.ml.dates[0], P.dates[ev.splitT], "backtest starts at the unseen period");
  const td = ML.today(P, res);
  assert.strictEqual(td.date, P.dates.at(-1));
  assert.strictEqual(td.list.length, P.stocks.length);
  assert.ok(td.list.every((x, k) => k === 0 || td.list[k - 1].z >= x.z), "sorted by score");
  assert.ok(td.list.every(x => x.prob > 0 && x.prob < 1 && x.reasons.length > 0 && x.reasons.length <= 4));
});

test("pure noise gives no out-of-sample edge", async () => {
  const r = rng(11), stocks = 60, days = 760, closes = [];
  for (let i = 0; i < stocks; i++) { let x = 100; closes.push(Array.from({ length: days }, () => (x *= 1 + gauss(r) * 0.015))); }
  const index = closes[0].map((_, t) => closes.reduce((a, c) => a + c[t] / c[0], 0) / stocks * 100);
  const dates = index.map((_, t) => new Date(Date.UTC(2020, 0, 1 + t)).toISOString().slice(0, 10));
  const P = S.prepare({ dates, index, symbols: closes.map((_, i) => `S${i}`), closes, sectors: closes.map(() => "X"), names: closes.map((_, i) => `S${i}`) });
  const algo = { ...A.PRESETS[0], eval: { horizon: 21, label: "beat", step: 2 } };
  const res = await ML.train(P, algo, A.evaluate(P, algo, { keepRows: true }), {});
  for (const m of res.models) assert.ok(Math.abs(m.roc.auc - 0.5) < 0.04, `${m.kind} test AUC ${m.roc.auc} on noise`);
});
