import { db, fb } from "../firebase-init.js";
import { $, inr, inrShort, pct, bootPage, fanChart } from "../shared.js";
import { loadFinancialCore } from "../core-finance.js";
import { portfolioStats, portfolioMonteCarlo } from "../engine.js";

const boot = await bootPage({ kind: "personal" });
if (!boot) await new Promise(() => {}); // redirecting
const { user, profile } = boot;
const { raw, fin } = await loadFinancialCore(fb, db, user, profile.id);

// Fixed correlation assumptions: equity, fixed income, real estate, cash
const CLASSES = [
  { key: "equity", name: "Equity", mu: 12, sigma: 25 },
  { key: "bond", name: "Fixed income", mu: 6, sigma: 10 },
  { key: "re", name: "Real estate", mu: 8, sigma: 15 },
  { key: "cash", name: "Cash", mu: 3, sigma: 1 },
];
const CORR = [[1, 0.2, 0.5, 0], [0.2, 1, 0.3, 0.1], [0.5, 0.3, 1, 0], [0, 0.1, 0, 1]];

// Prefill weights from real holdings: stocks→equity, general→fixed income, real estate, cash+liquid→cash
const w = { equity: fin.stocksValue, bond: 0, re: 0, cash: Math.max(0, fin.cash) };
for (const a of raw.assets) {
  const v = Number(a.currentValue) || 0;
  if (a.category === "real_estate") w.re += v; else if (a.category === "liquid") w.cash += v; else if (a.category === "stock") w.equity += v; else w.bond += v;
}
const tot = Object.values(w).reduce((s, v) => s + v, 0);
const start = tot > 0 ? Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +(v / tot * 100).toFixed(1)])) : { equity: 50, bond: 20, re: 20, cash: 10 };

$("capital").innerHTML = [
  ["Net worth", inr(fin.netWorth)], ["Monthly surplus", inr(fin.monthlySurplus)], ["Holdings used for weights", tot > 0 ? inrShort(tot) : "none yet (example mix)"],
].map(([l, v]) => `<div class="kpi"><span>${l}</span><strong>${v}</strong></div>`).join("");

$("allocRows").innerHTML = CLASSES.map((c) => `<tr><td>${c.name}</td>
  <td class="num"><input data-k="${c.key}" data-f="w" type="number" min="0" step="any" value="${start[c.key]}" style="width:90px"></td>
  <td class="num"><input data-k="${c.key}" data-f="mu" type="number" step="any" value="${c.mu}" style="width:90px"></td>
  <td class="num"><input data-k="${c.key}" data-f="sigma" type="number" min="0" step="any" value="${c.sigma}" style="width:90px"></td></tr>`).join("");
$("startWealth").value = Math.round(Math.max(0, fin.netWorth));
$("annualContribution").value = Math.round(fin.monthlySurplus * 12);

const val = (k, f) => Number(document.querySelector(`[data-k="${k}"][data-f="${f}"]`).value) || 0;

function run() {
  const weights = CLASSES.map((c) => val(c.key, "w") / 100);
  const total = weights.reduce((s, x) => s + x, 0);
  $("wTotal").textContent = (total * 100).toFixed(1);
  const bad = Math.abs(total - 1) > 0.005;
  $("wMsg").classList.toggle("hide", !bad);
  $("wMsg").textContent = `Weights add up to ${(total * 100).toFixed(1)}%. They need to total 100%.`;
  if (bad) return;
  const mu = CLASSES.map((c) => val(c.key, "mu") / 100), sg = CLASSES.map((c) => val(c.key, "sigma") / 100);
  const rf = mu[3]; // cash return is the risk-free rate
  const st = portfolioStats(weights, mu, sg, CORR, rf);
  const k = (l, v, s = "") => `<div class="kpi"><span>${l}</span><strong>${v}</strong>${s ? `<small>${s}</small>` : ""}</div>`;
  $("pStats").innerHTML = [k("Expected return", pct(st.expectedReturn, 2), "per year"), k("Volatility", pct(st.volatility, 2), "with correlations"), k("Sharpe ratio", st.sharpe.toFixed(2), `risk-free = cash return ${pct(rf, 1)}`)].join("");

  const startW = Number($("startWealth").value) || 0, contrib = Number($("annualContribution").value) || 0, years = Number($("qHorizon").value);
  const r = portfolioMonteCarlo({ start: startW, contribution: contrib, er: st.expectedReturn, vol: st.volatility }, { years, sims: 2000, seed: 42 });
  $("qStats").innerHTML = [
    k("Wealth grows", `${r.pGrow.toFixed(1)}%`, "ends above the starting amount"), k("Wealth declines", `${r.pDecline.toFixed(1)}%`),
    k("Falls below zero", `${r.pRuin.toFixed(1)}%`), k("Median outcome", inrShort(r.median), `5%: ${inrShort(r.worst)} · 95%: ${inrShort(r.best)}`),
  ].join("");
  const draw = () => fanChart("qChart", r.bands);
  $("qChart")._rerender = draw;
  if (typeof Chart === "undefined") addEventListener("load", draw, { once: true }); else draw();
}
document.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", run));
$("normBtn").onclick = () => {
  const ws = CLASSES.map((c) => val(c.key, "w")), t = ws.reduce((s, x) => s + x, 0);
  if (t <= 0) return;
  CLASSES.forEach((c, i) => { document.querySelector(`[data-k="${c.key}"][data-f="w"]`).value = (ws[i] / t * 100).toFixed(1); });
  run();
};
run();
