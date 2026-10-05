import "dotenv/config";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";

const PORT = Number(process.env.PORT) || 3000;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "true";
const origins = (process.env.ALLOWED_ORIGINS || "http://localhost:5000,http://127.0.0.1:5000,http://localhost:5500,http://127.0.0.1:5500").split(",").map((s) => s.trim());
if (REQUIRE_AUTH) admin.initializeApp({ projectId: "arbor-2f198" });

const app = express();
app.use(cors({ origin: origins }));

// naive per-IP rate limit: 60 requests / minute
const hits = new Map();
app.use((req, res, next) => {
  const k = req.ip, now = Date.now(), arr = (hits.get(k) || []).filter((t) => now - t < 60000);
  if (arr.length >= 60) return res.status(429).json({ error: "Too many requests." });
  arr.push(now); hits.set(k, arr); next();
});
app.use(async (req, res, next) => {
  if (!REQUIRE_AUTH) return next();
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return res.status(401).json({ error: "Sign in required." });
  try { await admin.auth().verifyIdToken(m[1]); next(); } catch { res.status(401).json({ error: "Invalid session." }); }
});

const TICKER = /^[A-Z0-9.&-]{1,20}$/;
async function yahoo(symbol) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return null;
  const j = await r.json();
  const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return Number(p) > 0 ? Number(p) : null;
}
async function twelve(symbol) {
  if (!process.env.TWELVE_KEY) throw new Error("TWELVE_KEY is not set on the backend.");
  const r = await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVE_KEY}`);
  const j = await r.json();
  return Number(j.price) > 0 ? Number(j.price) : null;
}

app.get("/stock", async (req, res) => {
  const ticker = String(req.query.ticker || "").toUpperCase(), exchange = String(req.query.exchange || "");
  if (!TICKER.test(ticker) || !["US", "NSE", "BSE"].includes(exchange)) return res.status(400).json({ error: "Invalid ticker or exchange." });
  try {
    const price = exchange === "US" ? await twelve(ticker) : await yahoo(`${ticker}.${exchange === "NSE" ? "NS" : "BO"}`);
    if (!price) return res.status(404).json({ error: `No price found for ${ticker} on ${exchange}.` });
    res.json({ price, currency: exchange === "US" ? "USD" : "INR" });
  } catch (e) {
    console.error(e.message);
    res.status(502).json({ error: "Price provider error." });
  }
});
app.get("/health", (_req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`Arbor stock backend on http://localhost:${PORT}`));
