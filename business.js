// One controller for all Business pages; the page is chosen by <body data-page="...">.
import { db, fb } from "../firebase-init.js";
import { $, esc, inr, pct, setText, todayISO, bootPage, busy, toast } from "../shared.js";
import { CHART, T, label, accountsOfType, computeBalances, kpisWithStock, finalAccounts, ledgerFor, trialBalance, QUICK } from "../accounting.js";

const { collection, addDoc, getDocs, query, where, doc, getDoc, updateDoc, deleteDoc } = fb;
const boot = await bootPage({ kind: "business" });
if (!boot) await new Promise(() => {}); // redirecting
const { user, profile } = boot;
const page = document.body.dataset.page;

let entries = [], prof = {};
async function load() {
  const [snap, p] = await Promise.all([
    getDocs(query(collection(db, "journalEntries"), where("uid", "==", user.uid), where("profileId", "==", profile.id))),
    getDoc(doc(db, "profiles", profile.id)),
  ]);
  entries = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => CHART[e.debitAccount] && CHART[e.creditAccount]);
  entries.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  prof = p.exists() ? p.data() : {};
  const unknown = snap.size - entries.length;
  if (unknown && $("notes")) $("notes").innerHTML = `<div class="notice warn">${unknown} journal entr${unknown === 1 ? "y uses" : "ies use"} an account that no longer exists and ${unknown === 1 ? "is" : "are"} ignored.</div>`;
}
const balances = () => computeBalances(entries);
const money = (v) => (Math.abs(v) < 0.005 ? "" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const opt = (a) => `<option value="${a}">${label(a)}</option>`;

async function addEntry(e) {
  await addDoc(collection(db, "journalEntries"), { uid: user.uid, profileId: profile.id, createdAt: new Date(), ...e });
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-del]");
  if (!b || !confirm("Delete this journal entry?")) return;
  busy(b, async () => { await deleteDoc(doc(db, "journalEntries", b.dataset.del)); toast("Entry deleted.", "good"); await load(); render(); });
});

// ================= pages =================
const pages = {
  dashboard() {
    $("title").textContent = profile.name || "Business";
    $("quickDate").value = todayISO();
    $("quickKind").innerHTML = QUICK.map((q) => `<option value="${q.id}">${q.label}</option>`).join("");
    $("quickPick").innerHTML = accountsOfType(T.DIRECT, T.INDIRECT).map(opt).join("");
    const cur = () => QUICK.find((q) => q.id === $("quickKind").value);
    const acct = (spec) => (spec.startsWith("pick:") ? $("quickPick").value : spec);
    const preview = () => {
      const q = cur(); $("pickRow").classList.toggle("hide", !(q.dr.startsWith("pick:") || q.cr.startsWith("pick:")));
      $("quickPreview").textContent = `Dr ${label(acct(q.dr))}  /  Cr ${label(acct(q.cr))}`;
    };
    $("quickKind").onchange = preview; $("quickPick").onchange = preview; preview();
    $("quickForm").onsubmit = (e) => {
      e.preventDefault();
      const amount = Number($("quickAmount").value), q = cur();
      if (!(amount > 0)) return toast("Amount must be greater than zero.", "warn");
      busy($("quickBtn"), async () => {
        await addEntry({ date: $("quickDate").value, debitAccount: acct(q.dr), creditAccount: acct(q.cr), amount, narration: $("quickNarr").value.trim(), source: "quick" });
        $("quickAmount").value = ""; $("quickNarr").value = "";
        toast("Entry recorded.", "good"); await load(); render();
      });
    };
  },
  journal() {
    const all = Object.keys(CHART);
    $("debitAccount").innerHTML = `<option value="">Select account</option>` + all.map(opt).join("");
    $("creditAccount").innerHTML = `<option value="">Select account</option>` + all.map(opt).join("");
    $("journalDate").value = todayISO();
    $("journalForm").onsubmit = (e) => {
      e.preventDefault();
      const d = $("debitAccount").value, c = $("creditAccount").value, amount = Number($("journalAmount").value);
      if (!d || !c || !(amount > 0)) return toast("Fill every field with a positive amount.", "warn");
      if (d === c) return toast("Debit and credit accounts must be different.", "warn");
      busy($("addJournalBtn"), async () => {
        await addEntry({ date: $("journalDate").value, debitAccount: d, creditAccount: c, amount, narration: $("journalNarr").value.trim() });
        $("journalAmount").value = ""; $("journalNarr").value = ""; toast("Entry added.", "good"); await load(); render();
      });
    };
  },
  ledger() {
    $("ledgerAccountSelect").innerHTML = `<option value="">Select account</option>` + Object.keys(CHART).map(opt).join("");
    $("ledgerAccountSelect").onchange = render;
  },
  trial() {},
  final() {
    $("printBtn").onclick = () => window.print();
    $("openingStockInput").value = prof.openingStock ?? "";
    $("closingStockInput").value = prof.closingStock ?? "";
    $("calculateFinalBtn").onclick = () => busy($("calculateFinalBtn"), async () => {
      const o = $("openingStockInput").value.trim(), c = Number($("closingStockInput").value) || 0;
      prof.openingStock = o === "" ? null : Number(o); prof.closingStock = c;
      await updateDoc(doc(db, "profiles", profile.id), { openingStock: prof.openingStock, closingStock: c });
      toast("Saved.", "good"); render();
    });
  },
  analytics() {},
};

const renderers = {
  dashboard() {
    const k = kpisWithStock(balances(), prof.closingStock || 0);
    const kp = (l, v, s = "", c = "") => `<div class="kpi"><span>${l}</span><strong class="${c}">${v}</strong>${s ? `<small>${s}</small>` : ""}</div>`;
    $("kpis").innerHTML = [
      kp("Revenue", inr(k.revenue)), kp("Expenses", inr(k.expense), "incl. stock adjustment"),
      kp("Net profit", inr(k.netProfit), `margin ${pct(k.margin)}`, k.netProfit >= 0 ? "pos" : "neg"),
      kp("Cash", inr(k.cash)), kp("Bank", inr(k.bank), k.bank < 0 ? "overdrawn" : "", k.bank < 0 ? "neg" : ""),
      kp("Total assets", inr(k.assets)), kp("Liabilities", inr(k.liabilities)), kp("Net worth", inr(k.equity), "assets − liabilities", k.equity >= 0 ? "pos" : "neg"),
    ].join("");
    if (!entries.length) $("notes").innerHTML = `<div class="notice">No entries yet. Start with “Capital introduced by owner”, then record sales and expenses.</div>`;
    else if (!prof.closingStock && balances().Purchases) $("notes").innerHTML = `<div class="notice warn">You have purchases but no closing stock saved, so profit treats all purchases as used up. Enter closing stock on the <a href="business-finalaccounts.html">Final Accounts</a> page.</div>`;
    else if (!k.fa.tallies) $("notes").innerHTML = `<div class="notice bad">Balance sheet is out by ${inr(Math.abs(k.fa.difference))}. See <a href="business-finalaccounts.html">Final Accounts</a>.</div>`;
    else $("notes").innerHTML = "";
    const recent = [...entries].reverse().slice(0, 10);
    $("recentList").innerHTML = recent.length ? recent.map((e) => `<tr><td>${esc(e.date)}</td><td>Dr ${label(e.debitAccount)}<br><small class="muted">Cr ${label(e.creditAccount)}${e.narration ? ` · ${esc(e.narration)}` : ""}</small></td><td class="num">${inr(e.amount)}</td><td class="num"><button class="btn ghost sm danger" data-del="${esc(e.id)}" type="button" aria-label="Delete entry">Delete</button></td></tr>`).join("") : `<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>`;
  },
  journal() {
    $("journalList").innerHTML = entries.length ? entries.map((e) => `
      <tr><td>${esc(e.date)}</td><td><strong>${label(e.debitAccount)}</strong> A/c <small class="muted">Dr</small></td><td class="num">${money(e.amount)}</td><td></td><td class="num" rowspan="2"><button class="btn ghost sm danger" data-del="${esc(e.id)}" type="button" aria-label="Delete entry">Delete</button></td></tr>
      <tr><td></td><td style="padding-left:28px">To ${label(e.creditAccount)} A/c${e.narration ? `<br><small class="muted">(${esc(e.narration)})</small>` : ""}</td><td></td><td class="num">${money(e.amount)}</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">No entries yet.</td></tr>`;
  },
  ledger() {
    const acc = $("ledgerAccountSelect").value, body = $("ledgerTableBody");
    if (!acc) { body.innerHTML = `<tr><td colspan="6" class="empty">Select an account.</td></tr>`; return; }
    const l = ledgerFor(entries, acc);
    const dr = l.dr.map((r) => ({ d: r.date, p: `To ${r.particulars}`, a: r.amount })), cr = l.cr.map((r) => ({ d: r.date, p: `By ${r.particulars}`, a: r.amount }));
    let bd = null;
    if (l.dr.length || l.cr.length) {
      const [y, m] = l.last.split("-").map(Number); const end = `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      if (l.balance > 0) { cr.push({ d: end, p: "By Balance c/d", a: l.balance, b: true }); bd = { side: "dr", d: end, p: "To Balance b/d", a: l.balance }; }
      else if (l.balance < 0) { dr.push({ d: end, p: "To Balance c/d", a: -l.balance, b: true }); bd = { side: "cr", d: end, p: "By Balance b/d", a: -l.balance }; }
    }
    const n = Math.max(dr.length, cr.length), cell = (r) => (r ? `<td>${esc(r.d)}</td><td>${r.b ? "<strong>" + esc(r.p) + "</strong>" : esc(r.p)}</td><td class="num">${money(r.a)}</td>` : "<td></td><td></td><td></td>");
    let html = "";
    for (let i = 0; i < n; i++) html += `<tr>${cell(dr[i])}${cell(cr[i])}</tr>`;
    if (!n) html = `<tr><td colspan="6" class="empty">No entries for this account.</td></tr>`;
    else {
      html += `<tr class="total"><td></td><td>Total</td><td class="num">${money(l.grandTotal)}</td><td></td><td>Total</td><td class="num">${money(l.grandTotal)}</td></tr>`;
      if (bd) html += `<tr>${bd.side === "dr" ? cell(bd) + cell(null) : cell(null) + cell(bd)}</tr>`;
    }
    body.innerHTML = html;
  },
  trial() {
    const t = trialBalance(balances());
    $("trialTableBody").innerHTML = t.rows.length
      ? t.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.account)}</td><td class="num">${r.bal > 0 ? money(r.bal) : ""}</td><td class="num">${r.bal < 0 ? money(-r.bal) : ""}</td></tr>`).join("") + `<tr class="total"><td></td><td><strong>Total</strong></td><td class="num"><strong>${money(t.dr)}</strong></td><td class="num"><strong>${money(t.cr)}</strong></td></tr>`
      : `<tr><td colspan="4" class="empty">No entries yet.</td></tr>`;
    const s = $("tbStatus"); s.textContent = t.rows.length ? (t.tallies ? "✓ Balanced" : "Not balanced") : ""; s.style.color = t.tallies ? "var(--good)" : "var(--bad)";
  },
  final() {
    const b = balances();
    $("openHint").textContent = b.OpeningStock ? `Leave blank to use the Opening Stock account (${inr(b.OpeningStock)}).` : "Stock on hand at the start of the period.";
    const fa = finalAccounts(b, { openingStock: prof.openingStock ?? null, closingStock: prof.closingStock || 0 });
    const side = (tbody, dr, cr, totalL, totalR) => {
      const n = Math.max(dr.length, cr.length); let h = "";
      for (let i = 0; i < n; i++) h += `<tr><td>${dr[i] ? esc(dr[i].name) : ""}</td><td class="num">${dr[i] ? money(dr[i].amount) : ""}</td><td>${cr[i] ? esc(cr[i].name) : ""}</td><td class="num">${cr[i] ? money(cr[i].amount) : ""}</td></tr>`;
      h += `<tr class="total"><td><strong>Total</strong></td><td class="num"><strong>${money(totalL)}</strong></td><td><strong>Total</strong></td><td class="num"><strong>${money(totalR)}</strong></td></tr>`;
      tbody.innerHTML = h || `<tr><td colspan="4" class="empty">No data.</td></tr>`;
    };
    side($("tradingBody"), fa.trading.dr, fa.trading.cr, fa.tradingTotal, fa.tradingTotal);
    side($("plBody"), fa.pl.dr, fa.pl.cr, fa.plTotal, fa.plTotal);
    side($("balanceSheetBody"), fa.bs.liabilities, fa.bs.assets, fa.liabTotal, fa.assetTotal);
    const msgs = [...fa.warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`)];
    if (entries.length) msgs.push(fa.tallies ? `<div class="notice good">Balance sheet tallies at ${inr(fa.assetTotal)}.</div>` : `<div class="notice bad">Balance sheet is out by ${inr(Math.abs(fa.difference))} (assets − liabilities). Check the journal and the stock figures.</div>`);
    $("faNotes").innerHTML = msgs.join("");
  },
  analytics() {
    const k = kpisWithStock(balances(), prof.closingStock || 0);
    const kp = (l, v, s = "") => `<div class="kpi"><span>${l}</span><strong>${v}</strong>${s ? `<small>${s}</small>` : ""}</div>`;
    $("profit").innerHTML = [kp("Net profit margin", pct(k.margin), "net profit ÷ revenue"), kp("Return on assets", pct(k.roa), "net profit ÷ total assets"), kp("Return on equity", k.roe === null ? "n/a" : pct(k.roe), "net profit ÷ net worth"), kp("Net profit", inr(k.netProfit))].join("");
    $("lev").innerHTML = [kp("Debt ratio", pct(k.debtRatio), "liabilities ÷ assets"), kp("Debt-to-equity", k.debtToEquity === null ? "n/a" : k.debtToEquity.toFixed(2), "liabilities ÷ net worth"), kp("Asset turnover", k.assetTurnover.toFixed(2), "revenue ÷ assets"), kp("Net worth", inr(k.equity))].join("");
    $("notes").innerHTML = entries.length ? "" : `<div class="notice">Record some entries first.</div>`;
  },
};

function render() { renderers[page]?.(); }
await load();
pages[page]?.();
render();
