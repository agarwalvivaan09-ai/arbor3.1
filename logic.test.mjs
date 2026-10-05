import test from "node:test";
import assert from "node:assert/strict";
import { scoreSavings, scoreDTI, scoreDSTI, scoreEmergency, scoreStability, computeHFRI, whatIfs, stressTest } from "../public/js/hfri.js";
import { computeFinancials } from "../public/js/core-finance.js";
import { computeBalances, computeKPIs, kpisWithStock, finalAccounts, trialBalance, ledgerFor } from "../public/js/accounting.js";
import { householdMonteCarlo, portfolioStats, portfolioMonteCarlo, mulberry32 } from "../public/js/engine.js";
import { indianNewRegimeTax } from "../public/js/tax.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("HFRI scoring curves reproduce the paper's anchor points (within fit error)", () => {
  // anchor tables from the HFRI page; the fitted curves are approximate (R2 0.9876-0.9997)
  for (const [sr, s] of [[-0.1, 0], [-0.04, 25], [0, 50], [0.07, 62], [0.17, 77], [0.3, 95]]) near(scoreSavings(sr), s, 6);
  for (const [d, s] of [[0, 100], [2.5, 65], [3.5, 45], [6, 5]]) near(scoreDTI(d), s, 5);
  for (const [d, s] of [[0, 100], [0.25, 70], [0.3, 55], [0.4, 20]]) near(scoreDSTI(d), s, 5);
  for (const [m, s] of [[0, 0], [1, 30], [3, 65], [6, 85], [12, 96]]) near(scoreEmergency(m), s, 4);
  for (const [cv, s] of [[0, 100], [0.1, 83], [0.33, 50], [0.5, 28], [1, 3]]) near(scoreStability(cv), s, 5);
});

test("HFRI curves are bounded 0..100 and handle extremes", () => {
  for (const v of [scoreSavings(-5), scoreSavings(5), scoreDTI(1e6), scoreDSTI(5), scoreDSTI(0), scoreEmergency(1e6), scoreStability(50)]) {
    assert.ok(v >= 0 && v <= 100 && Number.isFinite(v));
  }
});

test("computeHFRI: composite and guards", () => {
  const r = computeHFRI({ monthlyIncome: 100000, monthlySpending: 60000, essentialMonthly: 40000, liquidSavings: 240000, totalDebt: 0, monthlyDebtService: 0, cv: 0.1 });
  assert.equal(r.ready, true);
  near(r.score, 0.25 * (r.dims.S + r.dims.D + r.dims.E + r.dims.X), 1e-9);
  assert.equal(r.band.key, r.score >= 80 ? "resilient" : r.score >= 60 ? "stable" : r.score >= 40 ? "vulnerable" : "fragile");
  assert.equal(computeHFRI({ monthlyIncome: 0, monthlySpending: 1 }).ready, false);
  assert.equal(computeHFRI({ monthlyIncome: 100, monthlySpending: 0 }).ready, false);
  assert.equal(computeHFRI({ monthlyIncome: 100, monthlySpending: 50, cv: null }).cvAssumed, true);
});

test("heavier debt lowers HFRI; more cash raises it", () => {
  const base = { monthlyIncome: 100000, monthlySpending: 60000, essentialMonthly: 40000, liquidSavings: 100000, totalDebt: 0, monthlyDebtService: 0, cv: 0.2 };
  const a = computeHFRI(base).score;
  assert.ok(computeHFRI({ ...base, totalDebt: 2000000, monthlyDebtService: 30000 }).score < a);
  assert.ok(computeHFRI({ ...base, liquidSavings: 400000 }).score > a);
  assert.ok(whatIfs(base).length > 0);
});

test("stress test: deficit and runway", () => {
  const i = { monthlyIncome: 100000, monthlySpending: 60000, essentialMonthly: 40000, liquidSavings: 300000, totalDebt: 0, monthlyDebtService: 20000, cv: 0.2 };
  const s = stressTest(i, { incomeFall: 0.5, spendRise: 0, months: 3 });
  assert.equal(s.deficit, 30000); // 60k + 20k - 50k
  assert.equal(s.runway, 10);
  assert.equal(s.survives, true);
  assert.equal(stressTest(i, { incomeFall: 0, spendRise: 0, months: 6 }).runway, Infinity);
});

const NOW = "2026-10-05";
const tx = (date, type, amount, category = "x", extra = {}) => ({ date, type, amount, category, ...extra });

test("computeFinancials: monthly averaging uses completed months, applies tax, excludes EMI from spending", () => {
  const f = computeFinancials({
    taxRate: 0.1,
    transactions: [
      tx("2026-07-01", "income", 100000), tx("2026-08-01", "income", 100000), tx("2026-09-01", "income", 100000), tx("2026-10-01", "income", 100000),
      tx("2026-07-10", "expense", 30000), tx("2026-08-10", "expense", 30000), tx("2026-09-10", "expense", 30000),
      tx("2026-09-12", "expense", 10000, "Home Loan EMI"),
      tx("2026-11-01", "income", 999999), // future dated: ignored
    ],
    liabilities: [{ principalRemaining: 500000, monthlyPayment: 10000, interestRate: 9 }],
    assets: [{ currentValue: 50000, category: "liquid", growthRate: 3 }],
    stocks: [],
  }, { now: NOW });
  assert.equal(f.months, 3);
  near(f.grossMonthly, 100000, 1e-6); // 3 salaries / 3 completed months (not 4 / 3)
  near(f.netMonthly, 90000, 1e-6);
  near(f.spendingMonthly, 30000, 1e-6); // EMI excluded
  near(f.debtService, 10000, 1e-6); // from liabilities, not double counted
  near(f.monthlySurplus, 50000, 1e-6);
  // cash = 4 * 90000 - 90000 spend - 10000 emi
  near(f.cash, 360000 - 90000 - 10000, 1e-6);
  near(f.netWorth, f.cash + 50000 - 500000, 1e-6);
  near(f.liquidSavings, f.cash + 50000, 1e-6);
  assert.equal(f.cv, 0);
});

test("computeFinancials: US stocks converted with FX, dividends add to income", () => {
  const f = computeFinancials({ transactions: [tx("2026-09-01", "income", 1000)], stocks: [{ ticker: "AAPL", exchange: "US", quantity: 10, currentPrice: 200, purchasePrice: 150, dividendYield: 0.01 }] }, { now: NOW, fxUsdInr: 90 });
  near(f.stocksValue, 10 * 200 * 90, 1e-6);
  near(f.dividendsAnnual, 10 * 200 * 90 * 0.01, 1e-6);
});

test("computeFinancials: empty data is safe", () => {
  const f = computeFinancials({}, { now: NOW });
  assert.equal(f.hasData, false);
  assert.equal(computeHFRI(f.hfriInput).ready, false);
});

test("Indian tax estimate: no cliff at 12L, rebate, continuity", () => {
  assert.equal(indianNewRegimeTax(1275000, true).tax, 0);
  const a = indianNewRegimeTax(1500000).tax;
  near(a, 97500, 1);
  let prev = 0;
  for (let g = 0; g <= 4000000; g += 50000) { const t = indianNewRegimeTax(g).tax; assert.ok(t >= prev - 1e-6); assert.ok(t - prev < 60000, `jump at ${g}`); prev = t; }
});

test("accounting: books balance, final accounts tally", () => {
  const E = (d, dr, cr, amount) => ({ date: d, debitAccount: dr, creditAccount: cr, amount });
  const entries = [
    E("2026-04-01", "Cash", "Capital", 100000), E("2026-04-02", "Purchases", "Cash", 40000), E("2026-04-03", "Cash", "Sales", 70000),
    E("2026-04-04", "Wages", "Cash", 5000), E("2026-04-05", "Rent", "Cash", 3000),
  ];
  const b = computeBalances(entries);
  const tb = trialBalance(b);
  assert.equal(tb.tallies, true);
  const fa = finalAccounts(b, { closingStock: 10000 });
  assert.equal(fa.gross, 35000);
  assert.equal(fa.net, 32000);
  assert.equal(fa.assetTotal, 132000);
  assert.equal(fa.tallies, true);
  const k = computeKPIs(b);
  assert.equal(k.netProfit, 22000); // raw KPI: before stock adjustment
  near(k.equity, k.capitalIntroduced + k.netProfit - k.drawings, 1e-6);
  const ks = kpisWithStock(b, 10000);
  assert.equal(ks.netProfit, 32000); // agrees with the Final Accounts
  assert.equal(ks.equity, 132000);
  assert.equal(ks.assets, 132000);
  const l = ledgerFor(entries, "Cash");
  assert.equal(l.balance, 122000);
});

test("accounting: opening stock account feeds the trading account and still tallies; overdraft and drawings handled", () => {
  const E = (dr, cr, amount) => ({ date: "2026-04-01", debitAccount: dr, creditAccount: cr, amount });
  const entries = [E("OpeningStock", "Capital", 20000), E("Cash", "Capital", 50000), E("Purchases", "Bank", 30000), E("Bank", "Sales", 10000), E("Drawings", "Cash", 5000)];
  const fa = finalAccounts(computeBalances(entries), { closingStock: 12000 });
  assert.equal(fa.opening, 20000);
  assert.ok(fa.bs.liabilities.some((r) => r.name === "Bank Overdraft")); // Bank is -20000
  assert.equal(fa.tallies, true, `diff ${fa.difference}`);
});

test("engine: seeded Monte Carlo is reproducible and well-formed", () => {
  const s = { annualIncome: 1200000, annualSpend: 700000, cash: 300000, assets: [{ value: 500000, mu: 0.08, sigma: 0.15 }], debts: [{ balance: 400000, rate: 0.09, monthlyPayment: 10000, compounding: "compound" }] };
  const a = householdMonteCarlo(s, { years: 10, sims: 500 });
  const b = householdMonteCarlo(s, { years: 10, sims: 500 });
  assert.deepEqual(a.median, b.median);
  near(a.pGrow + a.pDecline + a.pInsolvent, 100, 1e-9);
  assert.equal(a.bands.p50.length, 11);
  assert.ok(a.bands.p5[10] <= a.bands.p50[10] && a.bands.p50[10] <= a.bands.p95[10]);
  assert.ok(a.pGrow > 50, "a household saving ~5L/yr should usually grow");
  // a household spending more than it earns should not usually grow
  const bad = householdMonteCarlo({ ...s, annualSpend: 1500000 }, { years: 10, sims: 300 });
  assert.ok(bad.pGrow < 20);
  // debt actually amortises (zero debt payment pressure after payoff)
  const noDebt = householdMonteCarlo({ ...s, debts: [] }, { years: 10, sims: 300 });
  assert.ok(noDebt.median > a.median - 1);
});

test("engine: portfolio statistics use correlations", () => {
  const w = [0.5, 0.5], mu = [0.12, 0.06], sg = [0.25, 0.1];
  const uncorr = portfolioStats(w, mu, sg, [[1, 0], [0, 1]]);
  const corr = portfolioStats(w, mu, sg, [[1, 0.5], [0.5, 1]]);
  near(uncorr.expectedReturn, 0.09, 1e-12);
  assert.ok(corr.volatility > uncorr.volatility);
  const r = portfolioMonteCarlo({ start: 100000, contribution: 10000, er: 0.09, vol: 0.15 }, { years: 10, sims: 300 });
  assert.ok(r.pGrow > 90);
  assert.ok(mulberry32(1)() !== mulberry32(2)());
});
