// HFRI - Household Financial Resilience Index (Vivaan Agarwal)
// Formulas, coefficients and anchors are taken from the published model:
// https://agarwalvivaan09-ai.github.io/HFRI/
//
// HFRI = 0.25*S + 0.25*D + 0.25*E + 0.25*X       D = 0.40*DDTI + 0.60*DDSTI
// All inputs to the scoring functions are RATIOS (0.25 = 25%), not percents.

export const HFRI_URL = "https://agarwalvivaan09-ai.github.io/HFRI/";
export const WEIGHTS = { S: 0.25, D: 0.25, E: 0.25, X: 0.25, DTI: 0.4, DSTI: 0.6 };
export const DEFAULT_CV = 0.2; // the HFRI calculator's default "Some swings" assumption

const clamp = (x, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/** Savings Strength. sr = (Y - C) / Y */
export function scoreSavings(sr) {
  return sr > -0.1 ? clamp(100 * (1 - Math.exp(-5.89681 * (sr + 0.1)))) : 0;
}
/** Debt-to-income component. dti = Debt / Y */
export function scoreDTI(dti) {
  return clamp(100 * Math.exp(-0.0573534 * Math.pow(Math.max(0, dti), 2.13509)));
}
/** Debt-service-to-income component. dsti = annual debt service / Y */
export function scoreDSTI(dsti) {
  const d = Math.max(0, dsti);
  return clamp(-521.45598 * d * d + 9.08245 * d + 100.00523);
}
/** Emergency Coverage. ec = liquid savings / monthly essential spending */
export function scoreEmergency(ec) {
  return clamp(100 * (1 - Math.exp(-0.37028 * Math.pow(Math.max(0, ec), 0.901391))));
}
/** Expense Stability. cv = std(monthly spending) / mean(monthly spending) */
export function scoreStability(cv) {
  return clamp(100 * Math.exp(-3.13957 * Math.pow(Math.max(0, cv), 1.30837)));
}

/** Arbor display bands (NOT from the paper - a presentation choice). */
export const BANDS = [
  { min: 80, key: "resilient", label: "Resilient", color: "var(--good)" },
  { min: 60, key: "stable", label: "Stable", color: "var(--accent)" },
  { min: 40, key: "vulnerable", label: "Vulnerable", color: "var(--warn)" },
  { min: 0, key: "fragile", label: "Fragile", color: "var(--bad)" },
];
export const bandFor = (score) => BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];

/**
 * @param {object} i
 *  monthlyIncome       take-home (after-tax) income per month
 *  monthlySpending     spending per month, EXCLUDING loan repayments
 *  essentialMonthly    essential spending per month (excluding loan repayments)
 *  liquidSavings       money reachable within days
 *  totalDebt           outstanding debt
 *  monthlyDebtService  all EMIs / minimum payments per month
 *  cv                  coefficient of variation of monthly spending, or null if unknown
 */
export function computeHFRI(i) {
  const monthlyIncome = num(i.monthlyIncome);
  const monthlySpending = num(i.monthlySpending);
  if (monthlyIncome <= 0 || monthlySpending <= 0) {
    return { ready: false, reason: "Add at least one income and one expense to calculate HFRI." };
  }
  const essential = num(i.essentialMonthly) > 0 ? num(i.essentialMonthly) : monthlySpending;
  const liquid = Math.max(0, num(i.liquidSavings));
  const debt = Math.max(0, num(i.totalDebt));
  const service = Math.max(0, num(i.monthlyDebtService));
  const cvAssumed = i.cv === null || i.cv === undefined || !Number.isFinite(Number(i.cv));
  const cv = cvAssumed ? DEFAULT_CV : Math.max(0, Number(i.cv));

  const Y = monthlyIncome * 12;
  const C = monthlySpending * 12;
  const SR = (Y - C) / Y;
  const DTI = debt / Y;
  const DSTI = (service * 12) / Y;
  const EC = liquid / essential;

  const S = scoreSavings(SR);
  const DDTI = scoreDTI(DTI);
  const DDSTI = scoreDSTI(DSTI);
  const D = WEIGHTS.DTI * DDTI + WEIGHTS.DSTI * DDSTI;
  const E = scoreEmergency(EC);
  const X = scoreStability(cv);
  const score = WEIGHTS.S * S + WEIGHTS.D * D + WEIGHTS.E * E + WEIGHTS.X * X;

  return {
    ready: true, score, band: bandFor(score), cvAssumed,
    dims: { S, D, E, X }, parts: { DDTI, DDSTI },
    raw: { SR, DTI, DSTI, EC, CV: cv },
  };
}

/** Sensitivity of the score to single changes. Illustrative, not advice. */
export function whatIfs(i) {
  const base = computeHFRI(i);
  if (!base.ready) return [];
  const ess = num(i.essentialMonthly) || num(i.monthlySpending);
  const tries = [
    ["Cut spending by 10%", { monthlySpending: i.monthlySpending * 0.9, essentialMonthly: Math.min(ess, i.monthlySpending * 0.9) }],
    ["Add one month of essential spending to liquid savings", { liquidSavings: num(i.liquidSavings) + ess }],
    ["Add three months of essential spending to liquid savings", { liquidSavings: num(i.liquidSavings) + 3 * ess }],
    ["Repay 20% of outstanding debt", { totalDebt: num(i.totalDebt) * 0.8, monthlyDebtService: num(i.monthlyDebtService) * 0.8 }],
    ["Lower monthly loan repayments by 20%", { monthlyDebtService: num(i.monthlyDebtService) * 0.8 }],
    ["Make monthly spending steadier (CV 0.10)", { cv: 0.1 }],
    ["Raise take-home income by 10%", { monthlyIncome: i.monthlyIncome * 1.1 }],
  ];
  return tries
    .map(([label, patch]) => {
      const next = computeHFRI({ ...i, ...patch });
      return { label, score: next.score, delta: next.score - base.score };
    })
    .filter((r) => r.delta >= 0.05)
    .sort((a, b) => b.delta - a.delta);
}

/**
 * Cash-flow stress test (an Arbor addition, not part of the paper).
 * A persistent shock is applied to the inputs, HFRI is recomputed, and liquid
 * savings are drawn down by any monthly deficit for `months` months.
 */
export function stressTest(i, { incomeFall = 0, spendRise = 0, months = 3 }) {
  const shocked = {
    ...i,
    monthlyIncome: num(i.monthlyIncome) * (1 - incomeFall),
    monthlySpending: num(i.monthlySpending) * (1 + spendRise),
    essentialMonthly: num(i.essentialMonthly) * (1 + spendRise),
  };
  const deficit = shocked.monthlySpending + num(i.monthlyDebtService) - shocked.monthlyIncome;
  const liquid = Math.max(0, num(i.liquidSavings));
  const runway = deficit > 0 ? liquid / deficit : Infinity;
  return {
    hfri: computeHFRI(shocked),
    deficit: Math.max(0, deficit),
    runway,
    liquidAfter: liquid - Math.max(0, deficit) * months,
    survives: deficit <= 0 || liquid >= deficit * months,
  };
}
