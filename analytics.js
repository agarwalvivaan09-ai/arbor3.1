import { db, fb } from "../firebase-init.js";
import { $, esc, inr, inrShort, pct, bootPage, fanChart } from "../shared.js";
import { loadFinancialCore } from "../core-finance.js";
import { computeHFRI, whatIfs, stressTest, bandFor } from "../hfri.js";
import { householdMonteCarlo } from "../engine.js";

const boot = await bootPage({ kind: "personal" });
if (!boot) await new Promise(() => {}); // redirecting
const { user, profile } = boot;
const { fin } = await loadFinancialCore(fb, db, user, profile.id);
const input = fin.hfriInput;
const base = computeHFRI(input);

$("printBtn").onclick = () => window.print();
$("notes").innerHTML = fin.notes.length ? `<div class="notice"><ul>${fin.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "";

// ---------- HFRI hero ----------
if (!base.ready) {
  $("hero").innerHTML = `<div class="gauge"><div><b>–</b></div></div><div><h2>HFRI</h2><p class="muted">${esc(base.reason)}</p><a class="btn" href="dashboard.html">Go to dashboard</a></div>`;
} else {
  const b = base;
  $("hero").innerHTML = `
    <div class="gauge" style="--pct:${b.score.toFixed(0)};--c:${b.band.color}"><div><b>${b.score.toFixed(0)}</b><small>of 100</small></div></div>
    <div><h2>Household Financial Resilience Index</h2>
      <p><span class="badge" style="color:${b.band.color}">${b.band.label}</span></p>
      <p class="muted" style="margin:0">Equal-weighted average of four dimensions, each scored 0–100 by the published HFRI curves. Bands are Arbor display labels (Resilient 80+, Stable 60+, Vulnerable 40+, Fragile below 40), not thresholds from the paper.</p></div>`;
  const dim = (name, score, detail) => `<div class="dim"><span>${name}</span><div class="track"><div class="fill" style="width:${score}%"></div></div><em>${score.toFixed(0)}</em><small class="muted">${detail}</small></div>`;
  $("dims").innerHTML =
    dim("Savings Strength", b.dims.S, `Savings rate ${pct(b.raw.SR)} of take-home income`) +
    dim("Debt Sustainability", b.dims.D, `Debt ${pct(b.raw.DTI, 0)} of annual income (score ${b.parts.DDTI.toFixed(0)}) · repayments ${pct(b.raw.DSTI)} of income (score ${b.parts.DDSTI.toFixed(0)}), weighted 40/60`) +
    dim("Emergency Coverage", b.dims.E, `${b.raw.EC.toFixed(1)} months of essential spending in liquid savings`) +
    dim("Expense Stability", b.dims.X, `Spending variation CV ${b.raw.CV.toFixed(2)}${b.cvAssumed ? " (assumed: fewer than 3 months of data)" : ""}`);
}

// ---------- ratios ----------
const grossAssets = fin.totalAssets + Math.max(0, fin.cash);
const ratio = (label, value, sub = "") => `<div class="kpi"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
$("ratios").innerHTML = [
  ratio("Savings rate", base.ready ? pct(base.raw.SR) : "–", "(income − spending) ÷ income"),
  ratio("Debt-to-income", base.ready ? pct(base.raw.DTI, 0) : "–", "total debt ÷ annual income"),
  ratio("Debt-service-to-income", base.ready ? pct(base.raw.DSTI) : "–", "annual repayments ÷ annual income"),
  ratio("Emergency cover", base.ready ? `${base.raw.EC.toFixed(1)} mo` : "–", "liquid savings ÷ essential spending"),
  ratio("Debt-to-assets", grossAssets > 0 ? pct(fin.totalDebt / grossAssets, 0) : "n/a", "debt ÷ (assets + cash)"),
  ratio("Solvency", grossAssets > 0 ? pct(fin.netWorth / grossAssets, 0) : "n/a", "net worth ÷ (assets + cash)"),
  ratio("Leverage", fin.netWorth > 0 ? (fin.totalDebt / fin.netWorth).toFixed(2) : "n/a", "debt ÷ net worth"),
  ratio("Monthly surplus", inr(fin.monthlySurplus), "after spending and repayments"),
].join("");

// ---------- what-ifs ----------
const wi = base.ready ? whatIfs(input) : [];
$("whatifs").innerHTML = wi.length
  ? wi.map((w) => `<div class="whatif"><span>${esc(w.label)}</span><strong class="pos">+${w.delta.toFixed(1)} → ${w.score.toFixed(0)}</strong></div>`).join("")
  : `<div class="empty">${base.ready ? "Nothing here would move the score noticeably. You are close to the top of the curves." : "Add data to see what would help most."}</div>`;

// ---------- stress ----------
function runStress() {
  const inc = Number($("incomeShockSlider").value) / 100, exp = Number($("expenseShockSlider").value) / 100, months = Number($("stressMonths").value);
  $("incLbl").textContent = `${(inc * 100).toFixed(0)}%`; $("expLbl").textContent = `${(exp * 100).toFixed(0)}%`;
  if (!base.ready) { $("stressOut").innerHTML = ""; $("stressVerdict").textContent = "Add data to run a stress test."; return; }
  const s = stressTest(input, { incomeFall: inc, spendRise: exp, months });
  const k = (l, v, sub = "", cls = "") => `<div class="kpi"><span>${l}</span><strong class="${cls}">${v}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const drop = s.hfri.score - base.score;
  $("stressOut").innerHTML = [
    k("Stressed HFRI", s.hfri.ready ? s.hfri.score.toFixed(0) : "0", s.hfri.ready ? `${drop.toFixed(1)} vs now · ${s.hfri.band.label}` : ""),
    k("Monthly shortfall", inr(s.deficit), "spending + repayments − income", s.deficit > 0 ? "neg" : "pos"),
    k("Runway", Number.isFinite(s.runway) ? `${s.runway.toFixed(1)} mo` : "No drawdown", "liquid savings ÷ shortfall"),
    k(`Liquid savings after ${months} mo`, inr(Math.max(0, s.liquidAfter)), s.liquidAfter < 0 ? "runs out" : ""),
  ].join("");
  $("stressVerdict").textContent = s.deficit <= 0
    ? "At this shock level your income still covers spending and repayments, so liquid savings are not drawn down."
    : s.survives ? `Liquid savings cover the shortfall for the full ${months} month${months > 1 ? "s" : ""}.`
      : `Liquid savings run out after about ${s.runway.toFixed(1)} months, before the ${months}-month period ends.`;
}
["incomeShockSlider", "expenseShockSlider", "stressMonths"].forEach((id) => $(id).addEventListener("input", runStress));
runStress();

// ---------- Monte Carlo ----------
function runMC() {
  const years = Number($("horizon").value);
  if (!fin.hasData || fin.mcState.annualIncome <= 0) { $("mcStats").innerHTML = `<div class="empty" style="grid-column:1/-1">Add income and expenses to run the projection.</div>`; return; }
  const r = householdMonteCarlo(fin.mcState, { years, sims: 2000, seed: 42 });
  const k = (l, v, sub = "", cls = "") => `<div class="kpi"><span>${l}</span><strong class="${cls}">${v}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
  $("mcStats").innerHTML = [
    k("Net worth grows", `${r.pGrow.toFixed(1)}%`, `ends above today's ${inrShort(r.startNW)}`, "pos"),
    k("Net worth declines", `${r.pDecline.toFixed(1)}%`, "ends at or below today's"),
    k("Insolvency risk", `${r.pInsolvent.toFixed(1)}%`, "net worth below zero at any year-end", r.pInsolvent > 10 ? "neg" : ""),
    k("Median outcome", inrShort(r.median), `5%: ${inrShort(r.worst)} · 95%: ${inrShort(r.best)}`),
  ].join("");
  const draw = () => fanChart("mcChart", r.bands, { label: "Median" });
  $("mcChart")._rerender = draw;
  if (typeof Chart === "undefined") addEventListener("load", draw, { once: true }); else draw();
}
$("horizon").onchange = runMC;
runMC();
