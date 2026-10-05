// Optional Cloud Function alternative to /backend. The API key is a secret, never hard-coded:
//   firebase functions:secrets:set TWELVE_KEY
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const TWELVE_KEY = defineSecret("TWELVE_KEY");

exports.stock = onRequest({ secrets: [TWELVE_KEY], cors: true }, async (req, res) => {
  const ticker = String(req.query.ticker || "").toUpperCase(), exchange = String(req.query.exchange || "");
  if (!/^[A-Z0-9.&-]{1,20}$/.test(ticker) || !["US", "NSE", "BSE"].includes(exchange)) return res.status(400).json({ error: "Invalid ticker or exchange." });
  try {
    let price = null;
    if (exchange === "US") {
      const j = await (await fetch(`https://api.twelvedata.com/price?symbol=${ticker}&apikey=${TWELVE_KEY.value()}`)).json();
      price = Number(j.price) > 0 ? Number(j.price) : null;
    } else {
      const sym = `${ticker}.${exchange === "NSE" ? "NS" : "BO"}`;
      const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
      const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      price = Number(p) > 0 ? Number(p) : null;
    }
    if (!price) return res.status(404).json({ error: "Price not found." });
    res.json({ price });
  } catch (e) { res.status(502).json({ error: "Price provider error." }); }
});
