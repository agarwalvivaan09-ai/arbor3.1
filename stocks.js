import { db, fb } from "../firebase-init.js";
import { $, esc, inr, pct, readNum, readStr, bootPage, busy, toast } from "../shared.js";
import { fetchProfileData, computeFinancials, isUSD, DEFAULT_FX, loadFxRate } from "../core-finance.js";
import { STOCK_API_URL } from "../config.js";

const { collection, addDoc, doc, updateDoc, deleteDoc } = fb;
const boot = await bootPage({ kind: "personal" });
if (!boot) await new Promise(() => {}); // redirecting
const { user, profile } = boot;
let stocks = [];

const MARKET = { US: { annualReturn: 0.09, annualVol: 0.2 }, NSE: { annualReturn: 0.11, annualVol: 0.24 }, BSE: { annualReturn: 0.11, annualVol: 0.24 } };
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const backendReachable = isLocal || !STOCK_API_URL.includes("localhost");

async function fetchQuote(ticker, exchange) {
  if (!backendReachable) throw new Error("Live quotes need a deployed backend. Set STOCK_API_URL in js/config.js.");
  const token = await user.getIdToken();
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`${STOCK_API_URL}?ticker=${encodeURIComponent(ticker)}&exchange=${encodeURIComponent(exchange)}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    const price = Number(body.price);
    if (!res.ok || !(price > 0)) throw new Error(body.error || "Live price unavailable.");
    return price;
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "Quote request timed out." : e.message === "Failed to fetch" ? "Could not reach the stock backend. Is it running?" : e.message);
  } finally { clearTimeout(timer); }
}

if (!backendReachable) {
  $("backendNote").innerHTML = `<div class="notice warn">Live quotes are off: <code>STOCK_API_URL</code> in <code>js/config.js</code> still points to localhost. You can still add holdings and set prices by hand.</div>`;
}

// FX
$("fxInput").value = loadFxRate() ?? DEFAULT_FX;
$("fxInput").onchange = () => {
  const v = readNum("fxInput");
  if (v > 0) { localStorage.setItem("arbor.fxUsdInr", String(v)); render(); toast("Exchange rate saved.", "good"); }
};

$("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const ticker = readStr("tickerInput").toUpperCase().replace(/[^A-Z0-9.&-]/g, ""), exchange = $("exchangeInput").value;
  const quantity = readNum("quantityInput"), purchasePrice = readNum("purchasePriceInput");
  if (!ticker || !(quantity > 0) || !(purchasePrice > 0)) return toast("Ticker, quantity and purchase price are required.", "warn");
  busy($("addStockBtn"), async () => {
    let currentPrice, source = "live";
    try { currentPrice = await fetchQuote(ticker, exchange); }
    catch (err) {
      const manual = readNum("manualPriceInput");
      currentPrice = manual > 0 ? manual : purchasePrice;
      source = manual > 0 ? "manual" : "purchase price";
      toast(`${err.message} Using ${source === "manual" ? "your price" : "the purchase price"} for now.`, "warn", 6000);
    }
    await addDoc(collection(db, "stocks"), {
      uid: user.uid, profileId: profile.id, ticker, exchange, currency: exchange === "US" ? "USD" : "INR", quantity, purchasePrice, currentPrice,
      lastPriceSource: source, lastPriceUpdate: new Date(), dividendYield: (readNum("dividendInput") || 0) / 100,
      volatility: MARKET[exchange].annualVol, expectedReturn: MARKET[exchange].annualReturn, createdAt: new Date(),
    });
    e.target.reset(); toast("Holding added.", "good"); await load();
  });
});

$("refreshStocksBtn").onclick = (e) => busy(e.currentTarget, async () => {
  if (!stocks.length) return toast("Add a holding first.", "warn");
  const results = await Promise.allSettled(stocks.map(async (s) => {
    const price = await fetchQuote(s.ticker, s.exchange || "NSE");
    await updateDoc(doc(db, "stocks", s.id), { currentPrice: price, lastPriceSource: "live", lastPriceUpdate: new Date() });
  }));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const firstErr = results.find((r) => r.status === "rejected")?.reason?.message;
  toast(`${ok} of ${stocks.length} prices updated.${firstErr ? ` ${firstErr}` : ""}`, ok === stocks.length ? "good" : "warn", 6000);
  await load();
});

$("stockList").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]"), set = e.target.closest("[data-price]");
  if (del && confirm("Remove this holding?")) busy(del, async () => { await deleteDoc(doc(db, "stocks", del.dataset.del)); await load(); });
  if (set) {
    const s = stocks.find((x) => x.id === set.dataset.price);
    const v = Number(prompt(`Current price of ${s.ticker} (${isUSD(s) ? "USD" : "INR"})`, s.currentPrice));
    if (v > 0) busy(set, async () => { await updateDoc(doc(db, "stocks", s.id), { currentPrice: v, lastPriceSource: "manual", lastPriceUpdate: new Date() }); await load(); });
  }
});

async function load() {
  const raw = await fetchProfileData(fb, db, user.uid, profile.id);
  stocks = raw.stocks; render();
}
function render() {
  const fx = loadFxRate() ?? DEFAULT_FX;
  const fin = computeFinancials({ stocks }, { fxUsdInr: fx });
  const gain = fin.stocksValue - fin.stocksCost;
  const k = (l, v, s = "", c = "") => `<div class="kpi"><span>${l}</span><strong class="${c}">${v}</strong>${s ? `<small>${s}</small>` : ""}</div>`;
  $("summary").innerHTML = [
    k("Portfolio value", inr(fin.stocksValue)), k("Invested", inr(fin.stocksCost)),
    k("Unrealised gain", inr(gain), fin.stocksCost > 0 ? pct(gain / fin.stocksCost) : "", gain >= 0 ? "pos" : "neg"),
    k("Dividends / year", inr(fin.dividendsAnnual), "counted as income"),
  ].join("");
  $("stockList").innerHTML = stocks.length ? stocks.map((s) => {
    const k2 = isUSD(s) ? fx : 1, sym = isUSD(s) ? "$" : "₹";
    const ret = s.purchasePrice > 0 ? (s.currentPrice - s.purchasePrice) / s.purchasePrice : 0;
    const when = s.lastPriceUpdate?.toDate ? s.lastPriceUpdate.toDate().toLocaleDateString("en-IN") : "";
    return `<tr><td><strong>${esc(s.ticker)}</strong> <span class="chip">${esc(s.exchange || "")}</span></td>
      <td class="num">${Number(s.quantity).toLocaleString("en-IN")}</td><td class="num">${sym}${Number(s.purchasePrice).toFixed(2)}</td><td class="num">${sym}${Number(s.currentPrice).toFixed(2)}</td>
      <td class="num">${inr(s.quantity * s.currentPrice * k2)}</td><td class="num ${ret >= 0 ? "pos" : "neg"}">${pct(ret, 2)}</td>
      <td><small class="muted">${esc(s.lastPriceSource || "–")}${when ? ` · ${when}` : ""}</small></td>
      <td class="num"><button class="btn ghost sm" data-price="${esc(s.id)}" type="button">Set price</button> <button class="btn ghost sm danger" data-del="${esc(s.id)}" type="button">Remove</button></td></tr>`;
  }).join("") : `<tr><td colspan="8" class="empty">No holdings yet.</td></tr>`;
}
await load();
