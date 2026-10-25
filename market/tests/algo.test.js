// node --test tests/algo.test.js   (run from market/)
const test = require("node:test"), assert = require("node:assert");
const S = require("../strategy.js"), A = require("../algo.js");

test("ROC AUC: perfect, inverted, all-tied and a known mixed case", () => {
  assert.strictEqual(A.roc([4, 3, 2, 1], [1, 1, 0, 0]).auc, 1);
  assert.strictEqual(A.roc([1, 2, 3, 4], [1, 1, 0, 0]).auc, 0);
  assert.strictEqual(A.roc([1, 1, 1, 1], [1, 0, 1, 0]).auc, 0.5);
  // pairs (pos,neg): (0.8,0.6)+ (0.8,0.2)+ (0.4,0.6)- (0.4,0.2)+  -> 3/4
  assert.strictEqual(A.roc([0.8, 0.4, 0.6, 0.2], [1, 1, 0, 0]).auc, 0.75);
  const r = A.roc([0.8, 0.4, 0.6, 0.2], [1, 1, 0, 0]);
  assert.deepStrictEqual(r.points[0], [0, 0]); assert.deepStrictEqual(r.points.at(-1), [1, 1]);
  assert.ok(r.lo < 0.75 && r.hi > 0.75);
});

test("confusion matrix and derived rates", () => {
  const c = A.confusion([1, 1, 0, 0, 1], [1, 0, 1, 0, 1], [0.1, -0.1, 0.05, -0.02, 0.2]);
  assert.deepStrictEqual([c.tp, c.fp, c.fn, c.tn], [2, 1, 1, 1]);
  assert.strictEqual(c.precision, 2 / 3); assert.strictEqual(c.recall, 2 / 3); assert.strictEqual(c.base, 3 / 5);
  assert.ok(Math.abs(c.avgFwdSignal - 0.2 / 3) < 1e-12);
  assert.strictEqual(c.decisionAuc, (2 / 3 + 1 / 2) / 2);
});

function panel(closes) {
  const dates = closes[0].map((_, t) => new Date(Date.UTC(2023, 0, 2 + t)).toISOString().slice(0, 10));
  return S.prepare({ dates, index: closes[0].map((_, t) => 100 + t), symbols: closes.map((_, i) => `S${i}`), closes,
    sectors: closes.map(() => "X"), names: closes.map((_, i) => `S${i}`) });
}

test("crosses-above fires only on the crossing day", () => {
  const c = [10, 10, 10, 10, 9, 9, 12, 12, 12];
  const P = panel([c]);
  const r = { a: { ind: "close" }, op: "xup", b: { ind: "num", v: 11 } };
  assert.deepStrictEqual(c.map((_, t) => A.ruleHolds(P, 0, r, t)), [false, false, false, false, false, false, true, false, false]);
});

test("algorithm decisions never use future prices", () => {
  let x = 100; const base = Array.from({ length: 400 }, (_, t) => (x *= 1 + Math.sin(t / 7) * 0.02));
  const algo = A.PRESETS[1], cut = 300;
  const P1 = panel([base, base.map(v => v * 1.1)]);
  const P2 = panel([base.map((v, t) => t > cut ? v * 2 : v), base.map((v, t) => t > cut ? v * 0.5 : v * 1.1)]);
  const C1 = A.compile(P1, algo), C2 = A.compile(P2, algo);
  for (let t = 0; t <= cut; t++) for (const i of [0, 1]) {
    assert.strictEqual(C1.entryFn(i, t), C2.entryFn(i, t));
    assert.strictEqual(C1.rankFn(i, t), C2.rankFn(i, t));
  }
});

test("evaluate produces consistent statistics", () => {
  let seed = 3; const r = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const closes = Array.from({ length: 20 }, () => { let p = 50; return Array.from({ length: 700 }, () => (p *= 1 + (r() - 0.5) * 0.04)); });
  const ev = A.evaluate(panel(closes), A.PRESETS[0], { from: 252 });
  const c = ev.all.confusion;
  assert.strictEqual(c.tp + c.fp + c.tn + c.fn, ev.rows);
  assert.ok(ev.all.roc.auc > 0 && ev.all.roc.auc < 1);
  assert.strictEqual(ev.all.deciles.reduce((a, d) => a + d.n, 0), ev.rows);
  assert.strictEqual(ev.inSample.n + ev.outSample.n, ev.rows);
});
