# Arbor v3.1

Household and business finance app scored with the **HFRI** (Household Financial Resilience Index, Vivaan Agarwal): https://agarwalvivaan09-ai.github.io/HFRI/

## Run
```
npm test                                   # logic tests (Node 20+)
npx firebase-tools emulators:start --only hosting,firestore
cd backend && cp .env.example .env && npm install && npm start    # optional live quotes
```
## Deploy
1. `npm run deploy` (hosting from `public/` + `firestore.rules`).
2. Deploy `backend/` (or `functions/`) somewhere and set `STOCK_API_URL` in `public/js/config.js`.
3. **Rotate the TwelveData key** that was hard-coded in the old `functions/index.js`; it is in your git history.

## Edit the Developer page
`public/js/developer-config.js`
