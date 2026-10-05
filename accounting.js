// Pure double-entry helpers for Business profiles.
export const T = { ASSET: "Asset", LIABILITY: "Liability", CAPITAL: "Capital", DRAWINGS: "Drawings", REVENUE: "Revenue", DIRECT: "Direct Expense", INDIRECT: "Indirect Expense", STOCK: "Opening Stock" };

// Keys are stored in Firestore - do not rename existing ones.
export const CHART = {
  Cash: T.ASSET, Bank: T.ASSET, AccountsReceivable: T.ASSET, Land: T.ASSET, Building: T.ASSET, Equipment: T.ASSET,
  OpeningStock: T.STOCK,
  AccountsPayable: T.LIABILITY, LoansPayable: T.LIABILITY,
  Capital: T.CAPITAL, Drawings: T.DRAWINGS,
  Sales: T.REVENUE,
  Purchases: T.DIRECT, Wages: T.DIRECT, CarriageInwards: T.DIRECT,
  Salary: T.INDIRECT, Rent: T.INDIRECT, Electricity: T.INDIRECT, OtherExpenses: T.INDIRECT,
};
export const label = (acc) => acc.replace(/([a-z])([A-Z])/g, "$1 $2");
export const accountsOfType = (...types) => Object.keys(CHART).filter((a) => types.includes(CHART[a]));
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/** balances[acc] = debits - credits */
export function computeBalances(entries) {
  const b = {};
  for (const e of entries) {
    const amt = num(e.amount);
    b[e.debitAccount] = (b[e.debitAccount] || 0) + amt;
    b[e.creditAccount] = (b[e.creditAccount] || 0) - amt;
  }
  return b;
}

export function computeKPIs(balances) {
  let revenue = 0, expense = 0, assets = 0, liabilities = 0, drawings = 0, capitalIntroduced = 0;
  for (const [acc, bal] of Object.entries(balances)) {
    const t = CHART[acc];
    if (t === T.REVENUE) revenue += -bal;
    else if (t === T.DIRECT || t === T.INDIRECT) expense += bal;
    else if (t === T.ASSET || t === T.STOCK) assets += bal;
    else if (t === T.LIABILITY) liabilities += -bal;
    else if (t === T.DRAWINGS) drawings += bal;
    else if (t === T.CAPITAL) capitalIntroduced += -bal;
  }
  const netProfit = revenue - expense;
  const equity = assets - liabilities;
  return {
    revenue, expense, netProfit, margin: revenue > 0 ? netProfit / revenue : 0,
    assets, liabilities, equity, drawings, capitalIntroduced, cash: balances.Cash || 0, bank: balances.Bank || 0,
    roa: assets > 0 ? netProfit / assets : 0,
    roe: equity > 0 ? netProfit / equity : 0,
    debtRatio: assets > 0 ? liabilities / assets : 0,
    debtToEquity: equity > 0 ? liabilities / equity : null,
    assetTurnover: assets > 0 ? revenue / assets : 0,
  };
}

/**
 * Trading A/c, P&L A/c and Balance Sheet from account balances.
 * opening/closing stock are optional overrides; opening defaults to the OpeningStock account.
 */
export function finalAccounts(balances, { openingStock = null, closingStock = 0 } = {}) {
  const bal = (a) => balances[a] || 0;
  const opening = openingStock === null || openingStock === "" ? Math.max(0, bal("OpeningStock")) : num(openingStock);
  const closing = Math.max(0, num(closingStock));

  const trading = { dr: [], cr: [] };
  const push = (side, name, amt) => { if (Math.abs(amt) > 0.004) side.push({ name, amount: amt }); };
  push(trading.dr, "Opening Stock", opening);
  push(trading.dr, "Purchases", bal("Purchases"));
  push(trading.dr, "Wages", bal("Wages"));
  push(trading.dr, "Carriage Inwards", bal("CarriageInwards"));
  push(trading.cr, "Sales", -bal("Sales"));
  push(trading.cr, "Closing Stock", closing);
  const trDr = trading.dr.reduce((s, r) => s + r.amount, 0);
  const trCr = trading.cr.reduce((s, r) => s + r.amount, 0);
  const gross = trCr - trDr;
  if (gross >= 0) push(trading.dr, "Gross Profit c/d", gross); else push(trading.cr, "Gross Loss c/d", -gross);
  const tradingTotal = Math.max(trDr, trCr);

  const pl = { dr: [], cr: [] };
  if (gross >= 0) push(pl.cr, "Gross Profit b/d", gross); else push(pl.dr, "Gross Loss b/d", -gross);
  for (const a of ["Salary", "Rent", "Electricity", "OtherExpenses"]) push(pl.dr, label(a), bal(a));
  const plDr = pl.dr.reduce((s, r) => s + r.amount, 0);
  const plCr = pl.cr.reduce((s, r) => s + r.amount, 0);
  const net = plCr - plDr;
  if (net >= 0) push(pl.dr, "Net Profit transferred to Capital", net); else push(pl.cr, "Net Loss transferred to Capital", -net);
  const plTotal = Math.max(plDr, plCr);

  const bs = { liabilities: [], assets: [] };
  for (const a of ["Cash", "Bank", "AccountsReceivable", "Land", "Building", "Equipment"]) {
    const v = bal(a);
    if (v >= 0) push(bs.assets, label(a), v);
    else push(bs.liabilities, a === "Bank" ? "Bank Overdraft" : `${label(a)} (credit balance)`, -v);
  }
  push(bs.assets, "Closing Stock", closing);
  for (const a of ["AccountsPayable", "LoansPayable"]) {
    const v = -bal(a);
    if (v >= 0) push(bs.liabilities, label(a), v); else push(bs.assets, `${label(a)} (debit balance)`, -v);
  }
  const capital = -bal("Capital") + net - bal("Drawings");
  push(bs.liabilities, "Capital (after profit and drawings)", capital);
  const liabTotal = bs.liabilities.reduce((s, r) => s + r.amount, 0);
  const assetTotal = bs.assets.reduce((s, r) => s + r.amount, 0);

  const warnings = [];
  const stockAcc = Math.max(0, bal("OpeningStock"));
  if (stockAcc > 0 && Math.abs(stockAcc - opening) > 0.5) warnings.push("The Opening Stock you entered differs from the Opening Stock account in the journal, so the balance sheet will not tally.");
  if (closing > opening + bal("Purchases") + bal("CarriageInwards") + bal("Wages")) warnings.push("Closing stock is higher than opening stock plus purchases and direct costs. Check the figure.");

  return { opening, closing, gross, net, capital, trading, tradingTotal, pl, plTotal, bs, liabTotal, assetTotal, difference: assetTotal - liabTotal, tallies: Math.abs(assetTotal - liabTotal) < 0.5, warnings };
}

/** KPIs that agree with the Final Accounts (profit after stock adjustment, equity incl. closing stock). */
export function kpisWithStock(balances, closingStock = 0) {
  const k = computeKPIs(balances);
  const fa = finalAccounts(balances, { closingStock });
  const assets = fa.assetTotal, equity = fa.capital, liabilities = assets - equity;
  return {
    ...k, fa, assets, equity, liabilities, netProfit: fa.net, expense: k.revenue - fa.net,
    margin: k.revenue > 0 ? fa.net / k.revenue : 0,
    roa: assets > 0 ? fa.net / assets : 0, roe: equity > 0 ? fa.net / equity : null,
    debtRatio: assets > 0 ? liabilities / assets : 0, debtToEquity: equity > 0 ? liabilities / equity : null,
    assetTurnover: assets > 0 ? k.revenue / assets : 0,
  };
}

/** Rows for one ledger account, T-account style. */
export function ledgerFor(entries, account) {
  const sorted = [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const dr = [], cr = [];
  for (const e of sorted) {
    if (e.debitAccount === account) dr.push({ date: e.date, particulars: label(e.creditAccount), amount: num(e.amount) });
    if (e.creditAccount === account) cr.push({ date: e.date, particulars: label(e.debitAccount), amount: num(e.amount) });
  }
  const totalDr = dr.reduce((s, r) => s + r.amount, 0), totalCr = cr.reduce((s, r) => s + r.amount, 0);
  const balance = totalDr - totalCr;
  const last = sorted.length ? String(sorted[sorted.length - 1].date) : "";
  return { dr, cr, totalDr, totalCr, balance, grandTotal: Math.max(totalDr, totalCr), last };
}

export function trialBalance(balances) {
  const rows = Object.keys(CHART).map((a) => ({ account: label(a), bal: balances[a] || 0 })).filter((r) => Math.abs(r.bal) > 0.004);
  const dr = rows.filter((r) => r.bal > 0).reduce((s, r) => s + r.bal, 0);
  const cr = rows.filter((r) => r.bal < 0).reduce((s, r) => s - r.bal, 0);
  return { rows, dr, cr, tallies: Math.abs(dr - cr) < 0.5 };
}

/** [debit, credit] templates for the quick-entry form. */
export const QUICK = [
  { id: "cash_sale", label: "Cash sale", dr: "Cash", cr: "Sales" },
  { id: "credit_sale", label: "Credit sale", dr: "AccountsReceivable", cr: "Sales" },
  { id: "expense", label: "Expense or purchase paid in cash", dr: "pick:expense", cr: "Cash" },
  { id: "capital", label: "Capital introduced by owner", dr: "Cash", cr: "Capital" },
  { id: "drawings", label: "Owner drawings", dr: "Drawings", cr: "Cash" },
  { id: "loan_in", label: "Loan received", dr: "Cash", cr: "LoansPayable" },
  { id: "loan_out", label: "Loan repaid", dr: "LoansPayable", cr: "Cash" },
  { id: "collect", label: "Cash received from a customer", dr: "Cash", cr: "AccountsReceivable" },
];
