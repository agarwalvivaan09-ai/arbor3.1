// Indicative Indian income-tax estimate, NEW regime, FY 2026-27 (slabs unchanged from FY 2025-26).
// Individual resident, salaried standard deduction of 75,000 optional, 87A rebate up to 12L taxable
// with marginal relief, 4% cess. Surcharge, capital-gains special rates and other deductions are ignored.
const SLABS = [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3]];

export function indianNewRegimeTax(annualGross, salaried = true) {
  const gross = Math.max(0, Number(annualGross) || 0);
  const taxable = Math.max(0, gross - (salaried ? 75000 : 0));
  let tax = 0, prev = 0;
  for (const [cap, rate] of SLABS) {
    if (taxable > prev) tax += (Math.min(taxable, cap) - prev) * rate;
    prev = cap;
  }
  tax = taxable <= 1200000 ? 0 : Math.min(tax, taxable - 1200000); // 87A rebate + marginal relief
  tax *= 1.04; // health & education cess
  return { taxable, tax, effective: gross > 0 ? tax / gross : 0 };
}
