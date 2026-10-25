/* Mode 2 · Algo Lab UI: build an algorithm from rules, run the decision test (ROC AUC etc.) and a portfolio backtest.
 * Uses helpers from app.js ($, esc, num, pct, pctTxt, store, settings, panel, state, currency, makeChart, line). */
"use strict";
const LAB = { algo: null, chart: null, ev: null, evKey: "", mlChart: null };
const IND_KEYS = Object.keys(Algo.INDICATORS);
const savedAlgos = () => store.get("v3.algos", {});

const clone = x => JSON.parse(JSON.stringify(x));
function blankAlgo() { return clone(Algo.PRESETS[0]); }

// ---------- builder ----------
function operandHtml(o, role) {
  const opts = IND_KEYS.filter(k => role === "a" ? k !== "num" : true)
    .map(k => `<option value="${k}" ${o.ind === k ? "selected" : ""}>${esc(Algo.INDICATORS[k].label)}</option>`).join("");
  const needN = Algo.INDICATORS[o.ind].n !== false, isNum = o.ind === "num";
  return `<select data-f="${role}.ind">${opts}</select>` +
    (needN ? `<input type="number" data-f="${role}.n" value="${o.n ?? Algo.INDICATORS[o.ind].n}" min="1" max="500" title="Period (days)">` : "") +
    (isNum ? `<input type="number" data-f="${role}.v" value="${o.v ?? 0}" step="any" title="Value">` : "");
}
function ruleHtml(r, k) {
  return `<div class="rule" data-k="${k}">${operandHtml(r.a, "a")}
    <select data-f="op">${Object.entries(Algo.OPS).map(([v, t]) => `<option value="${v}" ${r.op === v ? "selected" : ""}>${t}</option>`).join("")}</select>
    ${operandHtml(r.b, "b")}<button class="x" title="Remove rule" aria-label="Remove rule">✕</button></div>`;
}
function renderBuilder() {
  const a = LAB.algo;
  $("lab-name").value = a.name;
  $("lab-join").value = a.entry.join;
  $("lab-entry").innerHTML = a.entry.rules.map(ruleHtml).join("") || `<p class="muted" style="margin:0">No entry rules yet.</p>`;
  $("lab-exit").innerHTML = (a.exit.rules || []).map(ruleHtml).join("") || `<p class="muted" style="margin:0">No indicator exit; stops / max hold only.</p>`;
  $("lab-sl").value = a.exit.stopLossPct || 0; $("lab-tp").value = a.exit.takeProfitPct || 0; $("lab-hold").value = a.exit.maxHoldDays || 0;
  const rk = a.rank;
  $("lab-rank").innerHTML = `<select id="lab-rank-dir"><option value="high" ${rk.dir === "high" ? "selected" : ""}>highest</option>
      <option value="low" ${rk.dir === "low" ? "selected" : ""}>lowest</option></select>` + operandHtml(rk, "rank");
  $("lab-h").value = String(a.eval.horizon); $("lab-label").value = a.eval.label; $("lab-step").value = a.eval.step;
  $("lab-saved").innerHTML = `<option value="">—</option>` + Object.keys(savedAlgos()).sort()
    .map(n => `<option ${n === a.name ? "selected" : ""}>${esc(n)}</option>`).join("");
}
function setPath(obj, path, val) {
  const ks = path.split("."); let o = obj;
  for (let k = 0; k < ks.length - 1; k++) o = o[ks[k]];
  o[ks.at(-1)] = val;
}
function onRuleChange(listId, rules) {
  $(listId).addEventListener("change", e => {
    const row = e.target.closest(".rule"), f = e.target.dataset.f; if (!row || !f) return;
    const r = rules()[Number(row.dataset.k)], v = e.target.value;
    setPath(r, f, e.target.type === "number" ? Number(v) : v);
    if (f.endsWith(".ind")) { const side = f.split(".")[0], d = Algo.INDICATORS[v]; r[side] = { ind: v, ...(d.n !== false ? { n: d.n } : {}), ...(v === "num" ? { v: 0 } : {}) }; renderBuilder(); }
  });
  $(listId).addEventListener("click", e => {
    if (!e.target.closest(".x")) return;
    rules().splice(Number(e.target.closest(".rule").dataset.k), 1); renderBuilder();
  });
}
onRuleChange("lab-entry", () => LAB.algo.entry.rules);
onRuleChange("lab-exit", () => LAB.algo.exit.rules || (LAB.algo.exit.rules = []));
document.querySelectorAll("[data-add]").forEach(b => b.addEventListener("click", () => {
  const list = b.dataset.add === "entry" ? LAB.algo.entry.rules : (LAB.algo.exit.rules ||= []);
  list.push({ a: { ind: "close" }, op: ">", b: { ind: "sma", n: 50 } }); renderBuilder();
}));
$("lab-rank").addEventListener("change", e => {
  const rk = LAB.algo.rank;
  if (e.target.id === "lab-rank-dir") rk.dir = e.target.value;
  else if (e.target.dataset.f === "rank.ind") { const d = Algo.INDICATORS[e.target.value]; LAB.algo.rank = { ind: e.target.value, dir: rk.dir, ...(d.n !== false ? { n: d.n } : {}) }; renderBuilder(); }
  else if (e.target.dataset.f === "rank.n") rk.n = Number(e.target.value);
});
function readForm() {
  const a = LAB.algo;
  a.name = $("lab-name").value.trim() || "My algorithm";
  a.entry.join = $("lab-join").value;
  a.exit.stopLossPct = Number($("lab-sl").value) || 0; a.exit.takeProfitPct = Number($("lab-tp").value) || 0;
  a.exit.maxHoldDays = Number($("lab-hold").value) || 0;
  a.eval = { horizon: Number($("lab-h").value), label: $("lab-label").value, step: Math.max(1, Number($("lab-step").value) || 5) };
  return a;
}

$("lab-preset").innerHTML = `<option value="">—</option>` + Algo.PRESETS.map((p, k) => `<option value="${k}">${esc(p.name)}</option>`).join("");
$("lab-preset").addEventListener("change", e => { if (e.target.value !== "") { LAB.algo = clone(Algo.PRESETS[Number(e.target.value)]); renderBuilder(); } });
$("lab-saved").addEventListener("change", e => { const s = savedAlgos()[e.target.value]; if (s) { LAB.algo = clone(s); renderBuilder(); } });
$("lab-save").addEventListener("click", () => {
  const a = readForm(), all = savedAlgos(); all[a.name] = clone(a); store.set("v3.algos", all); store.set("v3.algo.current", a);
  renderBuilder(); $("lab-status").textContent = `Saved “${a.name}” in this browser.`;
});
$("lab-delete").addEventListener("click", () => {
  const all = savedAlgos(), n = $("lab-name").value.trim(); if (!all[n]) return;
  delete all[n]; store.set("v3.algos", all); renderBuilder(); $("lab-status").textContent = `Deleted “${n}”.`;
});

// ---------- run ----------
$("lab-run").addEventListener("click", async () => {
  const a = readForm();
  if (!a.entry.rules.length) { $("lab-status").textContent = "Add at least one entry rule."; return; }
  store.set("v3.algo.current", a);
  $("lab-run").disabled = true; $("lab-status").textContent = "Testing every decision…";
  await new Promise(r => setTimeout(r, 30));
  try {
    const P = await panel(state.market), T = P.dates.length - 1, years = Number($("lab-years").value);
    $("lab-uni").textContent = `${state.meta.markets[state.market].name} · ${P.stocks.length} stocks`;
    const from = Math.max(252, T - Math.round(252 * years));
    const t0 = performance.now();
    const ev = Algo.evaluate(P, a, { from, keepRows: true });
    LAB.ev = ev; LAB.evKey = evKey(a);
    $("lab-status").textContent = "Running the portfolio backtest…";
    await new Promise(r => setTimeout(r, 10));
    const bt = Algo.backtestAlgo(P, a, settings(state.market), { from });
    renderLab(ev, bt);
    $("lab-status").textContent = `${ev.rows.toLocaleString()} decisions scored and backtested in ${Math.round(performance.now() - t0)} ms`;
  } catch (err) { $("lab-status").textContent = `Error: ${err.message}`; }
  $("lab-run").disabled = false;
});

const evKey = a => JSON.stringify([state.market, $("lab-years").value, a.entry, a.rank, a.eval]);

// ---------- machine learning ----------
$("ml-run").addEventListener("click", async () => {
  const a = readForm();
  if (!a.entry.rules.length) { $("ml-status").textContent = "Add at least one entry rule."; return; }
  const say = t => { $("ml-status").textContent = t; };
  $("ml-run").disabled = $("lab-run").disabled = true;
  const t0 = performance.now();
  try {
    const P = await panel(state.market), T = P.dates.length - 1, years = Number($("lab-years").value);
    const from = Math.max(252, T - Math.round(252 * years));
    if (!LAB.ev || LAB.evKey !== evKey(a)) {
      say("Scoring the rules on every sampled stock-day…"); await new Promise(r => setTimeout(r, 30));
      LAB.ev = Algo.evaluate(P, a, { from, keepRows: true }); LAB.evKey = evKey(a);
    }
    const topPct = Number($("ml-top").value), mode = $("ml-mode").value;
    const res = await ML.train(P, a, LAB.ev, { topPct, onProgress: say });
    say("Backtesting the unseen period…"); await new Promise(r => setTimeout(r, 10));
    const bt = ML.backtestML(P, a, res, settings(state.market), { topPct, mode });
    renderML(res, bt, LAB.ev, mode);
    say(`Trained on ${res.counts.fit.toLocaleString()} samples, tested on ${res.counts.test.toLocaleString()} unseen ones in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } catch (err) { say(`Error: ${err.message}`); console.error(err); }
  $("ml-run").disabled = $("lab-run").disabled = false;
});

function renderML(res, bt, ev, mode) {
  const f3 = x => Number.isFinite(x) ? x.toFixed(3) : "–", pct1 = x => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "–";
  const best = res.models[res.best], [lg, gb] = res.models, rules = res.rulesOOS, b = res.boot;
  const gain = best.roc.auc - res.rulesAuc, lbl = ev.eval.label === "beat" ? "beat the index" : "rose";
  $("ml-out").hidden = false;
  $("ml-kpis").innerHTML = [
    ["Rules AUC (out of sample)", f3(res.rulesAuc), aucVerdict(res.rulesAuc)],
    ["Logistic AUC (out of sample)", f3(lg.roc.auc), `95% CI ${f3(lg.roc.lo)}–${f3(lg.roc.hi)}`],
    ["Boosted trees AUC (out of sample)", f3(gb.roc.auc), `95% CI ${f3(gb.roc.lo)}–${f3(gb.roc.hi)}`],
    ["AUC gain of chosen model", `<span class="${gain > 0 ? "up" : "down"}">${gain > 0 ? "+" : ""}${f3(gain)}</span>`,
      `${esc(best.label)} · day-bootstrap 95% CI ${b.lo > 0 ? "+" : ""}${f3(b.lo)} to ${b.hi > 0 ? "+" : ""}${f3(b.hi)} · not better in ${(b.pWorse * 100).toFixed(0)}% of resamples`],
    [`Precision of top ${res.topPct}%`, pct1(best.confusion.precision), `base rate ${pct1(best.confusion.base)} · rules ${pct1(rules.confusion.precision)}`],
    ["Lift", num(best.confusion.lift), `rules ${num(rules.confusion.lift)}`],
  ].map(([k, v, s]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");

  $("ml-roc").innerHTML = rocSvg([{ pts: rules.roc.points, c: "var(--text-secondary)" }, { pts: lg.roc.points, c: "var(--series-1)" },
    { pts: gb.roc.points, c: "var(--series-3)" }], `rules ${f3(res.rulesAuc)} · logit ${f3(lg.roc.auc)} · trees ${f3(gb.roc.auc)}`);

  const row = (name, tr, va, s, c, ic, chosen) => `<tr${chosen ? ' class="hl"' : ""}><td>${name}</td><td class="num">${f3(tr)}</td><td class="num">${f3(va)}</td>
    <td class="num"><b>${f3(s.auc)}</b><br><small class="muted">${f3(s.lo)}–${f3(s.hi)}</small></td><td class="num">${pct1(c.precision)}</td>
    <td class="num">${num(c.lift)}</td><td class="num">${f3(c.mcc)}</td><td class="num">${f3(ic)}</td></tr>`;
  $("ml-table").innerHTML = `<tr><th>Score</th><th class="num">Train AUC</th><th class="num">Valid. AUC</th><th class="num">Test AUC</th><th class="num">Precision</th>
    <th class="num">Lift</th><th class="num">MCC</th><th class="num">IC</th></tr>` +
    row("Rules (share met)", ev.inSample.roc.auc, NaN, rules.roc, rules.confusion, rules.ic, false) +
    res.models.map((m, k) => row(`${m.label}<br><small class="muted">${esc(m.detail)}</small>`, m.trainAuc, m.valAuc, m.roc, m.confusion, m.ic, k === res.best)).join("");
  const d = res.dates;
  $("ml-split").innerHTML = `Train ${d.fit[0]} → ${d.fit[1]} · validation ${d.val[0]} → ${d.val[1]} (picks the settings and the model) ·
    test ${d.test[0]} → ${d.test[1]} (never seen). Precision and MCC: ML buys the top ${res.topPct}% each day; rules buy when they pass.
    Highlighted = chosen by validation AUC.`;

  const feats = res.features.map((f, k) => ({ ...f, v: best.importance[k], c: best.coef ? best.coef[k] : null })).filter(f => !f.off)
    .sort((x, y) => y.v - x.v);
  const top = feats[0]?.v || 1;
  $("ml-imp-h").textContent = best.kind === "gbm" ? "share of split gain" : "|coefficient| share · orange = lower is better";
  $("ml-imp").innerHTML = feats.map(f => `<span>${esc(f.label)}</span><span><i class="${f.c != null && f.c < 0 ? "neg" : ""}" style="width:${(f.v / top * 100).toFixed(1)}%"></i></span>
    <span class="num muted">${(f.v * 100).toFixed(1)}%</span>`).join("");

  $("ml-dec").innerHTML = `<tr><th>Decile</th><th class="num">Samples</th><th class="num">Hit rate</th><th class="num">Avg fwd return</th></tr>` +
    best.deciles.map(x => `<tr><td>${x.bucket}</td><td class="num">${num(x.n, 0)}</td><td class="num">${pct1(x.hit)}</td><td class="num">${pct(x.avgFwd, 2)}</td></tr>`).join("");

  const m = bt.ml.metrics, r = bt.rules.metrics, ix = bt.ml.benchMetrics;
  $("ml-bt-h").textContent = `${bt.ml.dates[0]} → ${bt.ml.dates.at(-1)} · ${mode === "filter" ? "rules + ML" : "ML only"} · top ${res.topPct}%`;
  $("ml-bt-kpis").innerHTML = [
    ["CAGR", pct(m.cagr), `rules ${pctTxt(r.cagr)} · index ${pctTxt(ix.cagr)}`], ["Max DD", pct(m.maxDD), `rules ${pctTxt(r.maxDD)} · index ${pctTxt(ix.maxDD)}`],
    ["Sharpe", num(m.sharpe), `rules ${num(r.sharpe)} · index ${num(ix.sharpe)}`],
    ["Trades", num(m.trades, 0), `win ${m.winRate == null ? "–" : (m.winRate * 100).toFixed(0) + "%"} · rules ${num(r.trades, 0)}`],
  ].map(([k, v, s]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");
  if (LAB.mlChart) LAB.mlChart.remove();
  LAB.mlChart = null;
  $("ml-eq").innerHTML = "";
  if (typeof LightweightCharts !== "undefined") {
    LAB.mlChart = makeChart($("ml-eq"), 260);
    const ser = (b, key, col, w) => line(LAB.mlChart, css(col), w, { lastValueVisible: true }).setData(b.dates.map((d, k) => ({ time: d, value: b[key][k] })));
    ser(bt.ml, "equity", "--series-3", 2); ser(bt.rules, "equity", "--series-1", 1.5); ser(bt.ml, "bench", "--text-muted", 1.5);
    LAB.mlChart.timeScale().fitContent();
  } else $("ml-eq").innerHTML = `<p class="muted">Chart library did not load; the numbers above are complete.</p>`;

  const weakVal = best.valAuc < 0.52, overfit = best.trainAuc - best.roc.auc > 0.05;
  $("ml-note").innerHTML = `<b>How to read this.</b> Test AUCs are measured on dates the models never saw. An ML gain counts only if the
    day-bootstrap interval stays above 0${b.lo > 0 ? " — it does here" : " — here it does not, so the gain may be luck"}.
    ${weakVal ? "Validation AUC is near or below 0.52, so the model found little that held up even before the test period. " : ""}
    ${overfit ? `Train AUC (${f3(best.trainAuc)}) is well above test AUC: part of what the model learned was noise. ` : ""}
    Expect 0.52–0.55 at best for "${esc(lbl)}" over ${ev.eval.horizon} days; much higher out-of-sample numbers usually mean a leak.
    A better AUC ranks stocks better on average but does not guarantee a better portfolio: the backtest also depends on exits, slots and costs.
    Universe = today's index members (survivorship bias). Education only.`;
}

// ---------- results ----------
function aucVerdict(auc) {
  if (!Number.isFinite(auc)) return "–";
  if (auc >= 0.6) return "strong for markets";
  if (auc >= 0.55) return "useful edge";
  if (auc > 0.52) return "weak edge";
  if (auc >= 0.48) return "no edge (coin flip)";
  return "worse than random (inverted)";
}
function renderLab(ev, bt) {
  const A = ev.all, c = A.confusion, o = ev.outSample, i = ev.inSample, f3 = x => Number.isFinite(x) ? x.toFixed(3) : "–";
  $("lab-out").hidden = false;
  const lbl = ev.eval.label === "beat" ? "beat the index" : "rose";
  $("lab-kpis").innerHTML = [
    ["ROC AUC (score)", f3(A.roc.auc), `95% CI ${f3(A.roc.lo)}–${f3(A.roc.hi)} · ${aucVerdict(A.roc.auc)}`],
    ["Out-of-sample AUC", f3(o.roc.auc), `in-sample ${f3(i.roc.auc)} · unseen last 30% of dates`],
    ["Decision AUC", f3(c.decisionAuc), "buy / no-buy decision = (recall + specificity) ÷ 2"],
    ["Precision", `${(c.precision * 100).toFixed(1)}%`, `of buy signals ${lbl} · base rate ${(c.base * 100).toFixed(1)}%`],
    ["Lift", num(c.lift), "precision ÷ base rate (1 = no better than picking at random)"],
    ["MCC", f3(c.mcc), "Matthews correlation, −1…+1 (0 = no skill)"],
    ["Information coefficient", f3(A.ic), "rank correlation of score with forward return"],
    ["Avg forward return", `${pctTxt(c.avgFwdSignal)} <small class="muted">vs ${pctTxt(c.avgFwdOther)}</small>`, `${ev.eval.horizon} days after a buy signal vs no signal`],
    ["Signals", num(c.signals, 0), `of ${num(c.n, 0)} stock-days · recall ${(c.recall * 100).toFixed(1)}%`],
  ].map(([k, v, s]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");

  drawRoc(i.roc, o.roc);
  const pct1 = x => `${(x * 100).toFixed(1)}%`;
  $("lab-cm").innerHTML = `<tr><th></th><th>Outcome: ${esc(lbl)}</th><th>Outcome: did not</th><th>Total</th></tr>
    <tr><th>Buy signal</th><td class="hl up">${num(c.tp, 0)}<br><small>true positive</small></td><td class="down">${num(c.fp, 0)}<br><small>false positive</small></td><td>${num(c.tp + c.fp, 0)}</td></tr>
    <tr><th>No signal</th><td class="down">${num(c.fn, 0)}<br><small>missed</small></td><td class="hl">${num(c.tn, 0)}<br><small>true negative</small></td><td>${num(c.fn + c.tn, 0)}</td></tr>
    <tr><th>Total</th><td>${num(c.tp + c.fn, 0)}</td><td>${num(c.fp + c.tn, 0)}</td><td>${num(c.n, 0)}</td></tr>
    <tr><td colspan="4" class="muted" style="text-align:left;font-size:12px">Accuracy ${pct1(c.accuracy)} · precision ${pct1(c.precision)} · recall ${pct1(c.recall)} ·
      specificity ${pct1(c.specificity)} · F1 ${f3(c.f1)}</td></tr>`;
  const row = (name, s) => `<tr><td>${name}</td><td class="num">${f3(s.roc.auc)}</td><td class="num">${(s.confusion.precision * 100).toFixed(1)}%</td>
    <td class="num">${(s.confusion.base * 100).toFixed(1)}%</td><td class="num">${num(s.confusion.lift)}</td><td class="num">${pctTxt(s.confusion.avgFwdSignal)}</td><td class="num">${num(s.confusion.signals, 0)}</td></tr>`;
  $("lab-split").innerHTML = `<tr><th>Period</th><th class="num">AUC</th><th class="num">Precision</th><th class="num">Base</th><th class="num">Lift</th><th class="num">Fwd ret</th><th class="num">Signals</th></tr>` +
    row(`In-sample<br><small class="muted">${esc(ev.from)} → ${esc(ev.split)}</small>`, i) + row(`Out-of-sample<br><small class="muted">${esc(ev.split)} → ${esc(ev.to)}</small>`, o);
  $("lab-dec").innerHTML = `<tr><th>Decile</th><th class="num">Score</th><th class="num">Samples</th><th class="num">Hit rate</th><th class="num">Avg fwd return</th></tr>` +
    A.deciles.map(d => `<tr><td>${d.bucket}</td><td class="num">${d.scoreLo.toFixed(2)}–${d.scoreHi.toFixed(2)}</td><td class="num">${num(d.n, 0)}</td>
      <td class="num">${(d.hit * 100).toFixed(1)}%</td><td class="num">${pct(d.avgFwd, 2)}</td></tr>`).join("");

  const m = bt.metrics, b = bt.benchMetrics;
  $("lab-bt-kpis").innerHTML = [
    ["CAGR", pct(m.cagr), `index ${pctTxt(b.cagr)}`], ["Max DD", pct(m.maxDD), `index ${pctTxt(b.maxDD)}`],
    ["Sharpe", num(m.sharpe), `index ${num(b.sharpe)}`], ["Trades", num(m.trades, 0), `win ${m.winRate == null ? "–" : (m.winRate * 100).toFixed(0) + "%"}`],
  ].map(([k, v, s]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");
  if (LAB.chart) LAB.chart.remove();
  $("lab-eq").innerHTML = "";
  LAB.chart = makeChart($("lab-eq"), 260);
  line(LAB.chart, css("--series-1"), 2, { lastValueVisible: true }).setData(bt.dates.map((d, k) => ({ time: d, value: bt.equity[k] })));
  line(LAB.chart, css("--text-muted"), 1.5, { lastValueVisible: true }).setData(bt.dates.map((d, k) => ({ time: d, value: bt.bench[k] })));
  LAB.chart.timeScale().fitContent();
  $("lab-ntrades").textContent = `${bt.trades.length} closed · ${bt.state.positions.size} open · sizing from the Strategy tab`;
  $("lab-trades").innerHTML = `<thead><tr><th>Stock</th><th>In</th><th>Out</th><th class="num">Return</th><th class="num">Days</th><th class="opt">Exit reason</th></tr></thead><tbody>` +
    bt.trades.slice().reverse().slice(0, 300).map(t => `<tr><td class="sym">${esc(t.sym.replace(/\.BK$/, ""))}</td><td class="mono">${t.entryDate}</td>
      <td class="mono">${t.exitDate}</td><td class="num">${pct(t.ret)}</td><td class="num">${t.days}</td><td class="opt muted">${esc(t.reason)}</td></tr>`).join("") + "</tbody>";

  const dAuc = o.roc.auc - i.roc.auc;
  $("lab-note").innerHTML = `<b>Reading the numbers.</b> ROC AUC is the chance that a randomly chosen stock-day that ${esc(lbl)} got a higher score than one
    that did not: 0.50 is a coin flip; in stock markets even 0.53–0.55 out of sample is a real edge. Trust the <i>out-of-sample</i> AUC
    (${f3(o.roc.auc)}) more than the in-sample one${Math.abs(dAuc) > 0.02 ? ` — they differ by ${dAuc > 0 ? "+" : ""}${dAuc.toFixed(3)}, so the result is unstable` : ""}.
    Samples overlap in time (${ev.eval.horizon}-day outcomes sampled every ${ev.eval.step} days), so the confidence interval is too narrow.
    Universe = today's index members (survivorship bias).`;
}

function drawRoc(is, oos) {
  $("roc").innerHTML = rocSvg([{ pts: is.points, c: "var(--series-1)" }, { pts: oos.points, c: "var(--series-2)" }],
    `AUC in ${is.auc.toFixed(3)} · out ${oos.auc.toFixed(3)}`);
}
function rocSvg(curves, caption) {
  const W = 320, pad = 34, sz = W - pad - 10;
  const X = v => pad + v * sz, Y = v => 10 + (1 - v) * sz;
  const path = pts => pts.map((p, k) => `${k ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return `<svg viewBox="0 0 ${W} ${W}" role="img" aria-label="ROC curve: ${esc(caption)}">
    ${ticks.map(v => `<line x1="${X(v)}" y1="${Y(0)}" x2="${X(v)}" y2="${Y(1)}" stroke="var(--grid)"/><line x1="${X(0)}" y1="${Y(v)}" x2="${X(1)}" y2="${Y(v)}" stroke="var(--grid)"/>
      <text x="${X(v)}" y="${Y(0) + 14}" font-size="10" text-anchor="middle" fill="var(--text-muted)">${v}</text>
      <text x="${X(0) - 6}" y="${Y(v) + 3}" font-size="10" text-anchor="end" fill="var(--text-muted)">${v}</text>`).join("")}
    <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="var(--text-muted)" stroke-dasharray="4 4"/>
    ${curves.map(cv => `<path d="${path(cv.pts)}" fill="none" stroke="${cv.c}" stroke-width="2"/>`).join("")}
    <text x="${X(0.97)}" y="${Y(0.06)}" font-size="11" text-anchor="end" fill="var(--text-primary)">${esc(caption)}</text>
    <text x="${X(0.5)}" y="${W - 1}" font-size="10" text-anchor="middle" fill="var(--text-muted)">False positive rate</text>
    <text x="10" y="${Y(0.5)}" font-size="10" text-anchor="middle" fill="var(--text-muted)" transform="rotate(-90 10 ${Y(0.5)})">True positive rate</text>
  </svg>`;
}

$("mkt").addEventListener("click", () => { $("lab-out").hidden = $("ml-out").hidden = true; $("lab-status").textContent = $("ml-status").textContent = ""; LAB.ev = null; });
LAB.algo = store.get("v3.algo.current", null) || blankAlgo();
renderBuilder();
