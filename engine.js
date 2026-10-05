// Pure simulation helpers: seeded RNG, household Monte Carlo, portfolio statistics.
// Nothing here touches the DOM or Firebase, so it can be unit-tested in Node.

export function mulberry32(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * sortedAsc.length)));
  return sortedAsc[idx];
}
function bandsFromPaths(paths, years) {
  const out = { p5: [], p25: [], p50: [], p75: [], p95: [] };
  for (let y = 0; y <= years; y++) {
    const col = paths.map((p) => p[y]).sort((a, b) => a - b);
    out.p5.push(percentile(col, 0.05)); out.p25.push(percentile(col, 0.25));
    out.p50.push(percentile(col, 0.5)); out.p75.push(percentile(col, 0.75));
    out.p95.push(percentile(col, 0.95));
  }
  return out;
}

export const MC_DEFAULTS = {
  incomeGrowth: 0.05, incomeVol: 0.08, expenseInflation: 0.05, expenseVol: 0.05,
  jobLossProb: 0.04, jobLossRetained: 0.3, // a job-loss year keeps 30% of trend income, then recovers
  cashYield: 0.03, borrowRate: 0.12, marketCorrelation: 0.5,
};

/**
 * Household projection. All money is annual, nominal rupees.
 * state: { annualIncome, annualSpend, cash, debts:[{balance,rate,monthlyPayment,compounding}],
 *          assets:[{value, mu, sigma}] }
 */
export function householdMonteCarlo(state, { years = 10, sims = 2000, seed = 42, params = {} } = {}) {
  const P = { ...MC_DEFAULTS, ...params };
  const rng = mulberry32(seed);
  const startNW = state.cash + state.assets.reduce((s, a) => s + a.value, 0) - state.debts.reduce((s, d) => s + d.balance, 0);
  const paths = [];
  let insolvent = 0, grow = 0, decline = 0;

  for (let n = 0; n < sims; n++) {
    let trend = state.annualIncome, spend = state.annualSpend, cash = state.cash;
    const assets = state.assets.map((a) => a.value);
    const debts = state.debts.map((d) => ({ ...d, principal0: d.balance }));
    const path = [startNW];
    let broke = false;

    for (let y = 1; y <= years; y++) {
      trend *= Math.exp(P.incomeGrowth - 0.5 * P.incomeVol ** 2 + P.incomeVol * gaussian(rng));
      const income = trend * (rng() < P.jobLossProb ? P.jobLossRetained : 1);
      spend = Math.max(state.annualSpend, spend * Math.exp(P.expenseInflation - 0.5 * P.expenseVol ** 2 + P.expenseVol * gaussian(rng)));

      let debtPaid = 0;
      for (const d of debts) {
        if (d.balance <= 0) continue;
        const interest = (d.compounding === "simple" ? d.principal0 : d.balance) * d.rate;
        const pay = Math.min(d.monthlyPayment * 12, d.balance + interest);
        d.balance = Math.max(0, d.balance + interest - pay);
        debtPaid += pay;
      }
      cash += (cash >= 0 ? cash * P.cashYield : cash * P.borrowRate) + income - spend - debtPaid;

      const market = gaussian(rng);
      for (let k = 0; k < assets.length; k++) {
        const { mu, sigma } = state.assets[k];
        const z = Math.sqrt(P.marketCorrelation) * market + Math.sqrt(1 - P.marketCorrelation) * gaussian(rng);
        assets[k] *= Math.exp(mu - 0.5 * sigma * sigma + sigma * z);
      }
      const nw = cash + assets.reduce((s, v) => s + v, 0) - debts.reduce((s, d) => s + d.balance, 0);
      if (nw < 0) broke = true;
      path.push(nw);
    }
    paths.push(path);
    const end = path[years];
    if (broke) insolvent++; else if (end > startNW) grow++; else decline++;
  }
  const finals = paths.map((p) => p[years]).sort((a, b) => a - b);
  return {
    startNW, years, sims, bands: bandsFromPaths(paths, years),
    pGrow: (grow / sims) * 100, pDecline: (decline / sims) * 100, pInsolvent: (insolvent / sims) * 100,
    median: percentile(finals, 0.5), worst: percentile(finals, 0.05), best: percentile(finals, 0.95),
  };
}

/** Portfolio stats with a correlation matrix. weights/mu/sigma are arrays; corr is an n x n matrix. */
export function portfolioStats(weights, mu, sigma, corr, rf = 0.03) {
  const n = weights.length;
  let er = 0, variance = 0;
  for (let i = 0; i < n; i++) {
    er += weights[i] * mu[i];
    for (let j = 0; j < n; j++) variance += weights[i] * weights[j] * sigma[i] * sigma[j] * (i === j ? 1 : corr[i][j]);
  }
  const vol = Math.sqrt(Math.max(0, variance));
  return { expectedReturn: er, volatility: vol, sharpe: vol > 0 ? (er - rf) / vol : 0 };
}

/** Investing a fixed annual contribution into one portfolio. */
export function portfolioMonteCarlo({ start, contribution, er, vol }, { years = 10, sims = 2000, seed = 42 } = {}) {
  const rng = mulberry32(seed);
  const paths = [];
  let ruin = 0, grow = 0, decline = 0;
  for (let n = 0; n < sims; n++) {
    let w = start, broke = false;
    const path = [w];
    for (let y = 1; y <= years; y++) {
      w = w * Math.exp(er - 0.5 * vol * vol + vol * gaussian(rng)) + contribution;
      if (w < 0) broke = true;
      path.push(w);
    }
    paths.push(path);
    if (broke) ruin++; else if (w > start) grow++; else decline++;
  }
  const finals = paths.map((p) => p[years]).sort((a, b) => a - b);
  return {
    bands: bandsFromPaths(paths, years), pGrow: (grow / sims) * 100, pDecline: (decline / sims) * 100, pRuin: (ruin / sims) * 100,
    median: percentile(finals, 0.5), worst: percentile(finals, 0.05), best: percentile(finals, 0.95),
  };
}
