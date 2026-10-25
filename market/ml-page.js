/* ML Model page: three steps (what to predict, starting idea, train), a plain-language verdict, today's ranked picks with
 * reasons, and the expert details folded away. Uses app.js helpers and rocSvg / aucVerdict / savedAlgos / LAB from lab.js. */
"use strict";
const MLP = { res: null, today: null, chart: null };

function mlAlgoOptions() {
  const cur = LAB.algo, saved = savedAlgos(), sel = $("ml-algo").value;
  $("ml-algo").innerHTML = `<optgroup label="Algo Lab"><option value="current">Current: ${esc(cur.name)}</option></optgroup>` +
    `<optgroup label="Presets">${Algo.PRESETS.map((p, k) => `<option value="preset:${k}">${esc(p.name)}</option>`).join("")}</optgroup>` +
    (Object.keys(saved).length ? `<optgroup label="Saved">${Object.keys(saved).sort().map(n => `<option value="saved:${esc(n)}">${esc(n)}</option>`).join("")}</optgroup>` : "");
  if ([...$("ml-algo").options].some(o => o.value === sel)) $("ml-algo").value = sel;
}
function mlChosenAlgo() {
  const v = $("ml-algo").value, [label, horizon] = $("ml-target").value.split("|");
  const base = v.startsWith("preset:") ? Algo.PRESETS[Number(v.slice(7))] : v.startsWith("saved:") ? savedAlgos()[v.slice(6)] : readForm();
  return { ...clone(base), eval: { horizon: Number(horizon), label, step: 5 } };
}
window.addEventListener("hashchange", () => { if (location.hash === "#ml") mlAlgoOptions(); });
mlAlgoOptions();

// progress text -> bar position
function mlProgress(text) {
  $("ml-status").textContent = text;
  const m = text.match(/(\d+)\/(\d+)/), stage = [["Scoring the rules", 5], ["Building", 15], ["Fitting logistic", 25], ["Boosting", 30],
    ["Scoring the out", 78], ["Bootstrapping", 84], ["Refitting", 90], ["Backtesting", 95], ["Ranking", 98]].find(([k]) => text.startsWith(k));
  let p = stage ? stage[1] : 0;
  if (m && text.startsWith("Boosting")) p = 30 + 45 * Number(m[1]) / Number(m[2]);
  $("ml-prog").firstElementChild.style.width = `${p}%`;
}
const pause = ms => new Promise(r => setTimeout(r, ms));

$("ml-run").addEventListener("click", async () => {
  const a = mlChosenAlgo();
  if (!a.entry.rules.length) { $("ml-status").textContent = "The starting idea needs at least one entry rule (edit it in Algo Lab)."; return; }
  $("ml-run").disabled = true; $("ml-prog").hidden = false;
  const t0 = performance.now();
  try {
    const P = await panel(state.market), T = P.dates.length - 1;
    const from = Math.max(252, T - Math.round(252 * Number($("ml-years").value)));
    mlProgress("Scoring the rules on every sampled stock-day…"); await pause(30);
    const ev = Algo.evaluate(P, a, { from, keepRows: true });
    const topPct = Number($("ml-top").value), mode = $("ml-mode").value;
    const res = await ML.train(P, a, ev, { topPct, onProgress: mlProgress });
    mlProgress("Backtesting the unseen period…"); await pause(10);
    const bt = ML.backtestML(P, a, res, settings(state.market), { topPct, mode });
    mlProgress("Ranking today's stocks…"); await pause(10);
    MLP.res = res; MLP.today = ML.today(P, res);
    renderMLPage(res, bt, ev, a, mode);
    $("ml-status").textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s · learned from ${res.counts.fit.toLocaleString()} samples, graded on ${res.counts.test.toLocaleString()} unseen ones`;
  } catch (err) { $("ml-status").textContent = `Error: ${err.message}`; console.error(err); }
  $("ml-run").disabled = false; $("ml-prog").hidden = true;
});
$("mkt").addEventListener("click", () => { $("ml-out").hidden = true; $("ml-status").textContent = ""; MLP.res = null; });
$("ml-filter").addEventListener("input", renderToday);
$("ml-today").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-sym]"); if (!tr) return;
  location.hash = "#signals"; selectStock(tr.dataset.sym);
});

// ---------- verdict ----------
function mlVerdict(res) {
  const best = res.models[res.best], auc = best.roc.auc, val = best.valAuc, b = res.boot;
  if (auc >= 0.52 && val >= 0.52 && b.lo > 0)
    return { c: "var(--good)", icon: "✓", head: "Useful: the model ranks stocks better than chance and better than the starting idea",
      sub: "The edge held on dates it never saw and survived the resampling check. It is still small: use it to rank, not as a sure thing." };
  if (auc >= 0.51 && val >= 0.5)
    return { c: "var(--warning)", icon: "~", head: "Small edge, not proven",
      sub: "Slightly better than a coin flip on unseen dates, but it could be luck. Treat the picks as a tie-breaker only." };
  return { c: "var(--critical)", icon: "✗", head: "No reliable edge: don't trade these picks",
    sub: "On unseen dates the model was about as good as a coin flip. Try another target (e.g. 3 months) or starting idea." };
}

function renderMLPage(res, bt, ev, algo, mode) {
  const f3 = x => Number.isFinite(x) ? x.toFixed(3) : "–", p1 = x => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "–";
  const best = res.models[res.best], [lg, gb] = res.models, rules = res.rulesOOS, b = res.boot;
  const goal = ev.eval.label === "beat" ? "beat the market" : "rise", hz = { 10: "2 weeks", 21: "1 month", 63: "3 months" }[ev.eval.horizon] || `${ev.eval.horizon} days`;
  const v = mlVerdict(res);
  $("ml-out").hidden = false;
  $("ml-uni").textContent = `${state.meta.markets[state.market].name} · ${MLP.today.list.length} stocks`;
  const m = bt.ml.metrics, ix = bt.ml.benchMetrics;
  $("ml-verdict").style.setProperty("--c", v.c);
  $("ml-verdict").innerHTML = `<span class="icon">${v.icon}</span><div class="head">${v.head}</div><div class="muted">${v.sub}</div>
    <div class="nums">
      <div><div class="k">Picks the right stock of a pair</div><div class="v">${p1(best.roc.auc)}</div><div class="k">coin flip 50% · starting idea ${p1(res.rulesAuc)}</div></div>
      <div><div class="k">Top ${res.topPct}% picks that ${goal} in ${hz}</div><div class="v">${p1(best.confusion.precision)}</div><div class="k">average stock ${p1(best.confusion.base)}</div></div>
      <div><div class="k">Unseen-period return / year</div><div class="v">${pctTxt(m.cagr)}</div><div class="k">index ${pctTxt(ix.cagr)} · idea ${pctTxt(bt.rules.metrics.cagr)}</div></div>
    </div>`;

  renderToday();

  // what it looks at: logistic contributions are signed, tree gains are not
  const feats = res.features.map((f, k) => ({ ...f, v: best.importance[k], c: lg.coef[k] })).filter(f => !f.off).sort((x, y) => y.v - x.v).slice(0, 10);
  const top = feats[0]?.v || 1;
  $("ml-imp-h").textContent = "top 10 · green: higher helps · orange: lower helps";
  $("ml-imp").innerHTML = feats.map(f => `<span>${esc(f.label)}</span><span><i class="${f.c < 0 ? "neg" : ""}" style="width:${(f.v / top * 100).toFixed(1)}%;${f.c >= 0 ? "background:var(--series-3)" : ""}"></i></span>
    <span class="num muted">${(f.v * 100).toFixed(0)}%</span>`).join("");

  const r = bt.rules.metrics;
  $("ml-bt-h").textContent = `${bt.ml.dates[0]} → ${bt.ml.dates.at(-1)} · never seen in training`;
  $("ml-bt-kpis").innerHTML = [
    ["Return / year", pct(m.cagr), `idea ${pctTxt(r.cagr)} · index ${pctTxt(ix.cagr)}`],
    ["Worst drop", pct(m.maxDD), `idea ${pctTxt(r.maxDD)} · index ${pctTxt(ix.maxDD)}`],
    ["Trades", num(m.trades, 0), `win ${m.winRate == null ? "–" : (m.winRate * 100).toFixed(0) + "%"}`],
  ].map(([k, val, s]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${val}</div><div class="s">${s}</div></div>`).join("");
  if (MLP.chart) MLP.chart.remove();
  MLP.chart = null; $("ml-eq").innerHTML = "";
  if (typeof LightweightCharts !== "undefined") {
    MLP.chart = makeChart($("ml-eq"), 240);
    const ser = (x, key, col, w) => line(MLP.chart, css(col), w, { lastValueVisible: true }).setData(x.dates.map((d, k) => ({ time: d, value: x[key][k] })));
    ser(bt.ml, "equity", "--series-3", 2); ser(bt.rules, "equity", "--series-1", 1.5); ser(bt.ml, "bench", "--text-muted", 1.5);
    MLP.chart.timeScale().fitContent();
  } else $("ml-eq").innerHTML = `<p class="muted">Chart library did not load; the numbers above are complete.</p>`;

  // ---------- expert details ----------
  const gain = best.roc.auc - res.rulesAuc;
  $("ml-kpis").innerHTML = [
    ["Rules AUC (test)", f3(res.rulesAuc), aucVerdict(res.rulesAuc)],
    ["Logistic AUC (test)", f3(lg.roc.auc), `95% CI ${f3(lg.roc.lo)}–${f3(lg.roc.hi)}`],
    ["Boosted trees AUC (test)", f3(gb.roc.auc), `95% CI ${f3(gb.roc.lo)}–${f3(gb.roc.hi)}`],
    ["AUC gain", `<span class="${gain > 0 ? "up" : "down"}">${gain > 0 ? "+" : ""}${f3(gain)}</span>`,
      `day-bootstrap 95% CI ${f3(b.lo)} to ${f3(b.hi)} · not better in ${(b.pWorse * 100).toFixed(0)}% of resamples`],
    ["Lift", num(best.confusion.lift), `rules ${num(rules.confusion.lift)}`],
  ].map(([k, val, s]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${val}</div><div class="s">${s}</div></div>`).join("");
  $("ml-roc").innerHTML = rocSvg([{ pts: rules.roc.points, c: "var(--text-secondary)" }, { pts: lg.roc.points, c: "var(--series-1)" },
    { pts: gb.roc.points, c: "var(--series-3)" }], `rules ${f3(res.rulesAuc)} · logit ${f3(lg.roc.auc)} · trees ${f3(gb.roc.auc)}`);
  const row = (name, tr, va, s, c, ic, chosen) => `<tr${chosen ? ' class="hl"' : ""}><td>${name}</td><td class="num">${f3(tr)}</td><td class="num">${f3(va)}</td>
    <td class="num"><b>${f3(s.auc)}</b><br><small class="muted">${f3(s.lo)}–${f3(s.hi)}</small></td><td class="num">${p1(c.precision)}</td>
    <td class="num">${num(c.lift)}</td><td class="num">${f3(c.mcc)}</td><td class="num">${f3(ic)}</td></tr>`;
  $("ml-table").innerHTML = `<tr><th>Score</th><th class="num">Train AUC</th><th class="num">Valid. AUC</th><th class="num">Test AUC</th><th class="num">Precision</th>
    <th class="num">Lift</th><th class="num">MCC</th><th class="num">IC</th></tr>` +
    row("Rules (share met)", ev.inSample.roc.auc, NaN, rules.roc, rules.confusion, rules.ic, false) +
    res.models.map((x, k) => row(`${x.label}<br><small class="muted">${esc(x.detail)}</small>`, x.trainAuc, x.valAuc, x.roc, x.confusion, x.ic, k === res.best)).join("");
  const d = res.dates;
  $("ml-split").innerHTML = `Train ${d.fit[0]} → ${d.fit[1]} · validation ${d.val[0]} → ${d.val[1]} · test ${d.test[0]} → ${d.test[1]} (never seen).
    Highlighted = chosen by validation AUC. Today's picks use the same model refitted on all labelled data.`;
  $("ml-dec").innerHTML = `<tr><th>Decile</th><th class="num">Samples</th><th class="num">Hit rate</th><th class="num">Avg fwd return</th></tr>` +
    best.deciles.map(x => `<tr><td>${x.bucket}</td><td class="num">${num(x.n, 0)}</td><td class="num">${p1(x.hit)}</td><td class="num">${pct(x.avgFwd, 2)}</td></tr>`).join("");
  const overfit = best.trainAuc - best.roc.auc > 0.05;
  $("ml-note").innerHTML = `Starting idea: <b>${esc(algo.name)}</b> (${mode === "filter" ? "picks must also pass its rules" : "ML score only"}).
    ${best.valAuc < 0.52 ? "Validation AUC is below 0.52, so little held up even before the test period. " : ""}
    ${overfit ? `Train AUC (${f3(best.trainAuc)}) is well above test AUC: part of what was learned is noise. ` : ""}
    Expect 0.52–0.55 at best; much higher test numbers usually mean a leak. Universe = today's index members (survivorship bias). Education only, not investment advice.`;
}

// ---------- today's picks ----------
function reasonText(res, r) {
  const f = res.features[r.f];
  if (f.kind === "rules") return `Idea's rules met ${Math.round(r.x * 100)}%`;
  if (f.kind === "market") return f.label;
  return `${f.label}: ${r.x >= 0.67 ? "high" : r.x <= 0.33 ? "low" : "middle"}`;
}
function renderToday() {
  const res = MLP.res, T = MLP.today; if (!res || !T) return;
  const q = $("ml-filter").value.trim().toLowerCase();
  const goal = res.label === "beat" ? "beat the market" : "rise", hz = { 10: "2 weeks", 21: "1 month", 63: "3 months" }[res.horizon] || `${res.horizon} days`;
  const list = T.list.filter(x => !q || x.sym.toLowerCase().includes(q) || (x.name || "").toLowerCase().includes(q) || (x.sector || "").toLowerCase().includes(q));
  const show = q ? list.slice(0, 200) : list.slice(0, 50);
  const why = (x, cls = "") => `<div class="why ${cls}">${x.reasons.map(r => `<span class="${r.v > 0 ? "p" : "m"}" title="${r.v > 0 ? "raises" : "lowers"} the chance">${r.v > 0 ? "▲" : "▼"} ${esc(reasonText(res, r))}</span>`).join("")}</div>`;
  $("ml-today-h").textContent = `close of ${T.date} · estimated chance to ${goal} in ${hz} (average ${(res.baseRate * 100).toFixed(0)}%) · top 50 of ${T.list.length} · tap a row for the chart`;
  $("ml-today").innerHTML = `<thead><tr><th class="num">#</th><th>Stock</th><th class="opt">Sector</th><th class="num">Price</th><th>Chance</th><th class="opt">Why (strongest reasons)</th></tr></thead><tbody>` +
    show.map(x => `<tr data-sym="${esc(x.sym)}"><td class="num muted">${x.rank}</td>
      <td><span class="sym">${esc(x.sym.replace(/\.BK$/, ""))}</span><div class="sub">${esc(x.name || "")}</div>${why(x, "mob")}</td>
      <td class="opt muted">${esc(x.sector || "")}</td><td class="num">${num(x.price)}</td>
      <td class="num">${(x.prob * 100).toFixed(0)}%<span class="probbar"><i style="width:${Math.min(100, x.prob * 100).toFixed(0)}%"></i></span></td>
      <td class="opt">${why(x)}</td></tr>`).join("") +
    (show.length ? "" : `<tr><td colspan="6" class="muted">No match.</td></tr>`) + "</tbody>";
}
