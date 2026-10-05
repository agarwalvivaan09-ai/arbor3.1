// Single source of truth for personal finance numbers.
// computeFinancials() is pure (testable in Node); loadFinancialCore() reads Firestore.
//
// Definitions (the same on every page):
//  - Income transactions are GROSS. The profile's tax rate converts them to take-home.
//  - Monthly figures are averaged over up to the last 12 COMPLETED calendar months
//    (the current partial month is used only when nothing else exists).
//  - Spending excludes loan repayments (EMI/loan/repay categories). Debt service comes from
//    the Liabilities list, so it is never double counted.
//  - Cash = opening balance + take-home income - all expenses (including EMIs you logged).
//  - Net worth = cash + assets + stocks - debt.

export const DEBT_SERVICE_RE = /\b(emi|loan|repay|repayment|instal+ment|mortgage)\b/i;
export const DEFAULT_FX = 88; // USD->INR fallback; the user can change it on the Portfolio page
const ASSET_VOL = { general: 0.08, liquid: 0.01, real_estate: 0.1, stock: 0.22 };

const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mkey = (dateStr) => String(dateStr).slice(0, 7);

function monthRange(a, b) {
  const out = [];
  let [y, m] = a.split("-").map(Number);
  const [y2, m2] = b.split("-").map(Number);
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
export const isUSD = (s) => s.currency === "USD" || s.exchange === "US";

export function computeFinancials(raw, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const today = ymd(now);
  const fx = n(opts.fxUsdInr) > 0 ? n(opts.fxUsdInr) : DEFAULT_FX;
  const taxRate = Math.min(0.9, Math.max(0, n(raw.taxRate)));
  const openingCash = n(raw.openingCash);

  const tx = (raw.transactions || []).filter((t) => t.date && String(t.date) <= today && n(t.amount) > 0);
  const buckets = {};
  let cashIn = 0, cashOut = 0;
  for (const t of tx) {
    const k = mkey(t.date);
    const b = (buckets[k] ||= { gross: 0, spend: 0, essential: 0, debtSvc: 0 });
    const amt = n(t.amount);
    if (t.type === "income") { b.gross += amt; cashIn += amt * (1 - taxRate); }
    else if (t.type === "expense") {
      cashOut += amt;
      if (DEBT_SERVICE_RE.test(t.category || "")) b.debtSvc += amt;
      else { b.spend += amt; if (t.essential !== false) b.essential += amt; }
    }
  }
  const cash = openingCash + cashIn - cashOut;

  // Averaging window
  const keys = Object.keys(buckets).sort();
  const curKey = today.slice(0, 7);
  const completed = keys.filter((k) => k < curKey);
  let windowKeys = [];
  if (keys.length) {
    const pool = completed.length ? completed : keys;
    windowKeys = monthRange(pool[Math.max(0, pool.length - 12)], pool[pool.length - 1]).slice(-12);
  }
  const months = Math.max(1, windowKeys.length);
  const sum = (f) => windowKeys.reduce((s, k) => s + (buckets[k] ? buckets[k][f] : 0), 0);

  // Portfolio (stocks priced in USD are converted to INR)
  let stocksValue = 0, stocksCost = 0, dividendsAnnual = 0;
  for (const s of raw.stocks || []) {
    const k = isUSD(s) ? fx : 1;
    const v = n(s.quantity) * n(s.currentPrice) * k;
    stocksValue += v;
    stocksCost += n(s.quantity) * n(s.purchasePrice) * k;
    dividendsAnnual += v * n(s.dividendYield);
  }

  const grossMonthly = sum("gross") / months + dividendsAnnual / 12;
  const netMonthly = grossMonthly * (1 - taxRate);
  const spendingMonthly = sum("spend") / months;
  const essentialMonthly = sum("essential") / months;
  const loggedDebtMonthly = sum("debtSvc") / months;

  const liabilities = raw.liabilities || [];
  const totalDebt = liabilities.reduce((s, l) => s + n(l.principalRemaining), 0);
  const listedService = liabilities.reduce((s, l) => s + n(l.monthlyPayment), 0);
  const debtService = listedService > 0 ? listedService : loggedDebtMonthly;

  const assets = raw.assets || [];
  const otherAssets = assets.reduce((s, a) => s + n(a.currentValue), 0);
  const liquidAssets = assets.filter((a) => a.category === "liquid").reduce((s, a) => s + n(a.currentValue), 0);
  const totalAssets = otherAssets + stocksValue;
  const netWorth = cash + totalAssets - totalDebt;
  const liquidSavings = Math.max(0, cash) + liquidAssets;

  // Spending volatility from the last 6 window months
  const series = windowKeys.slice(-6).map((k) => (buckets[k] ? buckets[k].spend : 0));
  let cv = null;
  if (series.length >= 3) {
    const mean = series.reduce((s, v) => s + v, 0) / series.length;
    if (mean > 0) cv = Math.sqrt(series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length) / mean;
  }

  const monthlySurplus = netMonthly - spendingMonthly - debtService;
  const notes = [];
  if (!tx.length) notes.push("No transactions yet.");
  else if (months < 3) notes.push(`Only ${months} month${months === 1 ? "" : "s"} of data: averages are rough and spending stability is assumed.`);
  if (cv === null && tx.length) notes.push("Spending stability needs at least 3 months; the HFRI default (CV 0.20) is used.");
  if ((raw.stocks || []).some(isUSD) && !opts.fxUsdInr) notes.push(`US holdings are converted at ₹${DEFAULT_FX}/$. Set your rate on the Portfolio page.`);

  const hfriInput = {
    monthlyIncome: netMonthly, monthlySpending: spendingMonthly, essentialMonthly: essentialMonthly || spendingMonthly,
    liquidSavings, totalDebt, monthlyDebtService: debtService, cv,
  };

  // Inputs for the household Monte Carlo
  const mcAssets = assets.filter((a) => n(a.currentValue) > 0).map((a) => ({
    value: n(a.currentValue), mu: n(a.growthRate) / 100, sigma: ASSET_VOL[a.category] ?? ASSET_VOL.general,
  }));
  for (const s of raw.stocks || []) {
    const v = n(s.quantity) * n(s.currentPrice) * (isUSD(s) ? fx : 1);
    if (v > 0) mcAssets.push({ value: v, mu: n(s.expectedReturn) || 0.1, sigma: n(s.volatility) || ASSET_VOL.stock });
  }
  const mcState = {
    annualIncome: netMonthly * 12, annualSpend: spendingMonthly * 12, cash, assets: mcAssets,
    debts: liabilities.map((l) => ({
      balance: n(l.principalRemaining), rate: n(l.interestRate) / 100, monthlyPayment: n(l.monthlyPayment), compounding: l.compounding || "compound",
    })),
  };

  return {
    taxRate, months, windowKeys, hasData: tx.length > 0, notes,
    grossMonthly, netMonthly, spendingMonthly, essentialMonthly, debtService, monthlySurplus,
    cash, liquidAssets, liquidSavings, otherAssets, stocksValue, stocksCost, dividendsAnnual, totalAssets, totalDebt, netWorth,
    cv, hfriInput, mcState, fx,
  };
}

export function loadFxRate() {
  const v = Number(localStorage.getItem("arbor.fxUsdInr"));
  return v > 0 ? v : null;
}

/** Reads everything for one profile from Firestore. */
export async function fetchProfileData(fb, db, uid, profileId) {
  const { collection, getDocs, query, where, doc, getDoc } = fb;
  const q = (name) => getDocs(query(collection(db, name), where("uid", "==", uid), where("profileId", "==", profileId)));
  const [tx, lia, ast, stk, gl, tax, prof] = await Promise.all([
    q("transactions"), q("liabilities"), q("assets"), q("stocks"), q("goals"),
    getDoc(doc(db, "taxSettings", profileId)), getDoc(doc(db, "profiles", profileId)),
  ]);
  const rows = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
  return {
    transactions: rows(tx), liabilities: rows(lia), assets: rows(ast), stocks: rows(stk), goals: rows(gl),
    taxRate: tax.exists() ? n(tax.data().taxRate) / 100 : 0,
    openingCash: prof.exists() ? n(prof.data().openingCash) : 0,
    profile: prof.exists() ? { id: prof.id, ...prof.data() } : null,
  };
}

export async function loadFinancialCore(fb, db, user, profileId) {
  const raw = await fetchProfileData(fb, db, user.uid, profileId);
  return { raw, fin: computeFinancials(raw, { fxUsdInr: loadFxRate() }) };
}
