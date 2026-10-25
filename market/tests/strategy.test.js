// node --test tests/   (run from market/)
const test = require("node:test"), assert = require("node:assert");
const S = require("../strategy.js");

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
function makePanel(nStocks = 40, nDays = 900, seed = 1) {
  const r = rng(seed), dates = [], d = new Date("2022-01-03T00:00:00Z");
  for (let t = 0; t < nDays; t++) { dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + (d.getUTCDay() === 5 ? 3 : 1)); }
  const closes = [], sectors = [], symbols = [];
  for (let i = 0; i < nStocks; i++) {
    let p = 50 + 50 * r(); const drift = (r() - 0.4) * 0.002, c = [];
    for (let t = 0; t < nDays; t++) { p *= Math.exp(drift + (r() - 0.5) * 0.04); c.push(t < (i % 5) * 30 ? NaN : p); }
    closes.push(c); sectors.push(`Sector ${i % 4}`); symbols.push(`S${i}`);
  }
  let ix = 1000; const index = dates.map(() => (ix *= 1.0005 + (r() - 0.5) * 0.01));
  return { dates, index, symbols, closes, sectors, names: symbols };
}

test("indicators match simple definitions", () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.deepStrictEqual(S.sma(a, 3).slice(2), [2, 3, 4, 5]);
  assert.ok(Number.isNaN(S.sma(a, 3)[1]));
  assert.deepStrictEqual(S.rollingMax([3, 1, 4, 1, 5, 2], 3), [3, 3, 4, 4, 5, 5]);
  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  assert.strictEqual(S.rsi(up).at(-1), 100);
});

test("backtest never looks ahead", () => {
  const panel = makePanel(), cut = 700;
  const a = S.backtest(S.prepare(panel), { slots: 8 }, { from: 300, to: cut });
  const changed = { ...panel, closes: panel.closes.map(c => c.map((x, t) => t > cut ? x * (t % 2 ? 3 : 0.3) : x)),
    index: panel.index.map((x, t) => t > cut ? x * 0.1 : x) };
  const b = S.backtest(S.prepare(changed), { slots: 8 }, { from: 300, to: cut });
  assert.deepStrictEqual(a.equity, b.equity);
  assert.deepStrictEqual(a.trades, b.trades);
});

test("slots, sector cap, lot size and stops are respected", () => {
  const P = S.prepare(makePanel(60, 900, 7));
  const p = { slots: 6, sectorCap: 2, lot: 100, capital: 1e6 };
  const L = S.live(P, p);
  assert.ok(L.positions <= 6);
  for (const n of Object.values(L.sectors)) assert.ok(n <= 2);
  const buys = L.rows.filter(r => r.status === "BUY");
  assert.ok(L.positions + buys.length <= 6);
  for (const r of L.rows) {
    if (r.plan) {
      assert.strictEqual(r.plan.shares % 100, 0);
      if (r.pass === 5) assert.ok(r.plan.stop < r.plan.entry, `${r.sym} stop below entry`);
    }
  }
  for (const t of L.backtest.trades) assert.strictEqual(t.shares % 100, 0);
});

test("risk-based sizing risks about the set % of equity", () => {
  const P = S.prepare(makePanel(10, 600, 3)), t = 590, s = P.stocks[0];
  const p = { ...S.DEFAULTS, sizing: "risk", riskPct: 1, stopVolMult: 3, maxPosPct: 100, lot: 1 };
  const shares = S.sizeShares(s, t, 100000, p), stopDist = 3 * s.vol20[t] * s.c[t];
  assert.ok(Math.abs(shares * stopDist - 1000) <= stopDist + 1);
});

test("auto backtest reports in- and out-of-sample results", async () => {
  const P = S.prepare(makePanel(30, 900, 5));
  const r = await S.autoBacktest(P, {}, { slots: [5, 10], trailPct: [10, 20] }, { from: 300, top: 3 });
  assert.strictEqual(r.combos, 4);
  assert.strictEqual(r.top.length, 3);
  assert.ok(r.top[0].is.sharpe >= r.top[1].is.sharpe);
  assert.ok(r.inSample[1] < r.outSample[0]);
  for (const x of r.top) assert.ok(Number.isFinite(x.oos.cagr));
});
