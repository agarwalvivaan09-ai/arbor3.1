import { db, fb } from "../firebase-init.js";
import { $, esc, inr, pct, setText, readNum, readStr, todayISO, bootPage, busy, toast } from "../shared.js";
import { loadFinancialCore, computeFinancials, loadFxRate, DEBT_SERVICE_RE } from "../core-finance.js";
import { computeHFRI } from "../hfri.js";
import { indianNewRegimeTax } from "../tax.js";

const { collection, addDoc, doc, setDoc, updateDoc, deleteDoc } = fb;
const boot = await bootPage({ kind: "personal" });
if (!boot) await new Promise(() => {}); // redirecting
const { user, profile } = boot;
let data = null;

setText("title", profile.name || "Dashboard");
$("subtitle").textContent = profile.mode === "family" ? "Your family's money at a glance." : "Your money at a glance.";
$("dateInput").value = todayISO();

// ---------- drawer ----------
const drawer = $("sidePanel"), scrim = $("scrim");
const openDrawer = (tab) => { drawer.classList.add("open"); scrim.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); if (tab) showTab(tab); };
const closeDrawer = () => { drawer.classList.remove("open"); scrim.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); };
function showTab(name) {
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".tabpanel").forEach((p) => { p.hidden = p.dataset.panel !== name; });
}
$("openPanelBtn").onclick = () => openDrawer("tx");
$("closePanelBtn").onclick = closeDrawer; scrim.onclick = closeDrawer;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
document.querySelectorAll(".tabs [data-tab]").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$("typeInput").onchange = () => {
  const inc = $("typeInput").value === "income";
  $("essentialRow").hidden = inc; $("amountLabel").textContent = inc ? "Gross amount (₹)" : "Amount (₹)";
};

// ---------- writes ----------
const base = () => ({ uid: user.uid, profileId: profile.id });
const positive = (v, label) => { if (!(v > 0)) { toast(`${label} must be greater than zero.`, "warn"); return false; } return true; };

$("txForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = readNum("amountInput"), type = $("typeInput").value, category = readStr("categoryInput"), date = readStr("dateInput");
  if (!positive(amount, "Amount")) return;
  if (!category || !date) return toast("Category and date are required.", "warn");
  busy($("addBtn"), async () => {
    const t = { ...base(), amount, type, category, date, createdAt: new Date() };
    if (type === "expense") t.essential = $("essentialInput").checked;
    await addDoc(collection(db, "transactions"), t);
    $("amountInput").value = ""; $("categoryInput").value = "";
    toast("Transaction added.", "good"); await refresh();
  });
});
$("assetForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const currentValue = readNum("assetValue"), type = readStr("assetType");
  if (!type || !positive(currentValue, "Value")) return;
  busy($("addAssetBtn"), async () => {
    await addDoc(collection(db, "assets"), { ...base(), type, currentValue, growthRate: readNum("growthRate") || 0, category: $("assetCategory").value, createdAt: new Date() });
    e.target.reset(); toast("Asset added.", "good"); await refresh();
  });
});
$("debtForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const principalRemaining = readNum("principalInput"), type = readStr("liabilityType");
  if (!type || !positive(principalRemaining, "Principal")) return;
  busy($("addLiabilityBtn"), async () => {
    await addDoc(collection(db, "liabilities"), { ...base(), type, principalRemaining, interestRate: readNum("interestInput") || 0, monthlyPayment: readNum("monthlyPaymentInput") || 0, compounding: $("liabilityCompounding").value, createdAt: new Date() });
    e.target.reset(); toast("Debt added.", "good"); await refresh();
  });
});
$("estBtn").onclick = () => {
  const g = readNum("estGross");
  if (!(g > 0)) return toast("Enter your annual gross income.", "warn");
  const r = indianNewRegimeTax(g, $("estSalaried").checked);
  $("taxRateInput").value = (r.effective * 100).toFixed(2);
  $("estOut").textContent = `Estimated tax ${inr(r.tax)} a year, effective rate ${(r.effective * 100).toFixed(2)}%. Surcharge and deductions are ignored.`;
};
$("settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const rate = readNum("taxRateInput"), opening = readNum("openingCashInput");
  if (!Number.isNaN(rate) && (rate < 0 || rate > 90)) return toast("Tax rate must be between 0 and 90.", "warn");
  busy($("saveSettingsBtn"), async () => {
    await setDoc(doc(db, "taxSettings", profile.id), { ...base(), taxRate: Number.isNaN(rate) ? 0 : rate });
    await updateDoc(doc(db, "profiles", profile.id), { openingCash: Number.isNaN(opening) ? 0 : opening });
    toast("Settings saved.", "good"); await refresh();
  });
});
$("goalForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = readNum("goalAmount"), name = readStr("goalName");
  if (!name || !positive(amount, "Target")) return;
  busy($("addGoalBtn"), async () => { await addDoc(collection(db, "goals"), { ...base(), name, amount }); e.target.reset(); await refresh(); });
});

// deletes (event delegation)
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-del]");
  if (!b) return;
  const [col, id] = b.dataset.del.split(":");
  if (!confirm("Delete this item? This cannot be undone.")) return;
  busy(b, async () => { await deleteDoc(doc(db, col, id)); toast("Deleted.", "good"); await refresh(); });
});
$("txFilter").onchange = renderTransactions; $("txSearch").oninput = renderTransactions;

// ---------- render ----------
async function refresh() {
  const { raw, fin } = await loadFinancialCore(fb, db, user, profile.id);
  data = { raw, fin };
  if (document.activeElement?.id !== "taxRateInput") $("taxRateInput").value = raw.taxRate ? (raw.taxRate * 100).toString() : "";
  $("openingCashInput").value = raw.openingCash || "";
  renderNotes(fin); renderHero(fin); renderKpis(fin); renderGoals(raw, fin); renderTransactions(); renderAssets(raw, fin); renderDebts(raw);
}

function renderNotes(fin) {
  $("notes").innerHTML = fin.notes.length ? `<div class="notice"><ul>${fin.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "";
}
function renderHero(fin) {
  const r = computeHFRI(fin.hfriInput);
  if (!r.ready) {
    $("hfriHero").innerHTML = `<div class="gauge"><div><b>–</b></div></div><div><h2 id="hfriH">Household Financial Resilience Index</h2><p class="muted">${esc(r.reason)}</p><button class="btn" type="button" onclick="document.getElementById('openPanelBtn').click()">Add a transaction</button></div>`;
    return;
  }
  $("hfriHero").innerHTML = `
    <div class="gauge" style="--pct:${r.score.toFixed(0)};--c:${r.band.color}"><div><b>${r.score.toFixed(0)}</b><small>of 100</small></div></div>
    <div>
      <h2 id="hfriH">Household Financial Resilience Index</h2>
      <p><span class="badge" style="color:${r.band.color}">${r.band.label}</span>
      <span class="muted">Savings ${r.dims.S.toFixed(0)} · Debt ${r.dims.D.toFixed(0)} · Emergency cover ${r.dims.E.toFixed(0)} · Spending stability ${r.dims.X.toFixed(0)}</span></p>
      <a href="analytics.html">See the breakdown, stress test and projections →</a></div>`;
}
function renderKpis(fin) {
  const mo = `avg of ${fin.months} month${fin.months === 1 ? "" : "s"}`;
  const k = (label, value, sub = "", cls = "") => `<div class="kpi"><span>${label}</span><strong class="${cls}">${value}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
  $("kpis").innerHTML = [
    k("Take-home income", inr(fin.netMonthly), `per month · ${mo}`),
    k("Spending", inr(fin.spendingMonthly), "per month · excl. loan repayments"),
    k("Loan repayments", inr(fin.debtService), "per month"),
    k("Monthly surplus", inr(fin.monthlySurplus), "income − spending − repayments", fin.monthlySurplus >= 0 ? "pos" : "neg"),
    k("Cash balance", inr(fin.cash), "opening cash + income − expenses", fin.cash >= 0 ? "" : "neg"),
    k("Total assets", inr(fin.totalAssets), `incl. stocks ${inr(fin.stocksValue)}`),
    k("Total debt", inr(fin.totalDebt)),
    k("Net worth", inr(fin.netWorth), "cash + assets − debt", fin.netWorth >= 0 ? "pos" : "neg"),
  ].join("");
}
function renderGoals(raw, fin) {
  const el = $("goalList");
  if (!raw.goals.length) { el.innerHTML = `<div class="empty">No goals yet. Add one to see how long it could take.</div>`; return; }
  el.innerHTML = raw.goals.map((g) => {
    const progress = Math.max(0, Math.min(1, fin.netWorth / g.amount));
    const remaining = Math.max(0, g.amount - fin.netWorth);
    let eta;
    if (remaining === 0) eta = "Reached 🎉";
    else if (fin.monthlySurplus > 0) { const y = remaining / (fin.monthlySurplus * 12); eta = y < 1 ? `about ${Math.ceil(y * 12)} months at your current surplus` : `about ${y.toFixed(1)} years at your current surplus`; }
    else eta = "needs a positive monthly surplus";
    return `<div class="kpi"><div class="row" style="justify-content:space-between"><strong style="font-size:16px">${esc(g.name)}</strong><button class="btn ghost sm" data-del="goals:${esc(g.id)}" type="button">Remove</button></div>
      <div class="progress" role="progressbar" aria-valuenow="${(progress * 100).toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress * 100}%"></i></div>
      <small>${inr(Math.max(0, fin.netWorth))} of ${inr(g.amount)} (${(progress * 100).toFixed(0)}%) · ${eta}. Ignores investment growth.</small></div>`;
  }).join("");
}
function renderTransactions() {
  if (!data) return;
  const f = $("txFilter").value, s = $("txSearch").value.trim().toLowerCase();
  const rows = [...data.raw.transactions]
    .filter((t) => (f === "all" || t.type === f) && (!s || String(t.category).toLowerCase().includes(s)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || 0).slice(0, 100);
  $("transactionList").innerHTML = rows.length ? rows.map((t) => `
    <tr><td>${esc(t.date)}</td><td><span class="tag ${esc(t.type)}">${esc(t.type)}</span></td>
    <td>${esc(t.category)}${t.type === "expense" && DEBT_SERVICE_RE.test(t.category || "") ? ' <span class="chip">loan repayment</span>' : ""}${t.type === "expense" && t.essential === false ? ' <span class="chip">non-essential</span>' : ""}</td>
    <td class="num">${inr(t.amount)}</td><td class="num"><button class="btn ghost sm danger" data-del="transactions:${esc(t.id)}" type="button" aria-label="Delete transaction">Delete</button></td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">No transactions match.</td></tr>`;
}
function renderAssets(raw, fin) {
  const kind = { liquid: "Liquid", general: "General", real_estate: "Real estate", stock: "Stock" };
  const rows = raw.assets.map((a) => `<tr><td>${esc(a.type)}</td><td>${kind[a.category] || "General"}</td><td class="num">${inr(a.currentValue)}</td><td class="num">${esc(a.growthRate || 0)}%</td><td class="num"><button class="btn ghost sm danger" data-del="assets:${esc(a.id)}" type="button" aria-label="Delete asset">Delete</button></td></tr>`);
  if (fin.stocksValue > 0) rows.push(`<tr><td>Stock portfolio</td><td>Stocks</td><td class="num">${inr(fin.stocksValue)}</td><td class="num">market</td><td></td></tr>`);
  $("assetList").innerHTML = rows.join("") || `<tr><td colspan="5" class="empty">No assets yet.</td></tr>`;
}
function renderDebts(raw) {
  $("liabilityList").innerHTML = raw.liabilities.map((l) => `<tr><td>${esc(l.type)}</td><td class="num">${inr(l.principalRemaining)}</td><td class="num">${esc(l.interestRate || 0)}%</td><td class="num">${inr(l.monthlyPayment || 0)}</td><td class="num"><button class="btn ghost sm danger" data-del="liabilities:${esc(l.id)}" type="button" aria-label="Delete debt">Delete</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No debts. Nice.</td></tr>`;
}

await refresh();
