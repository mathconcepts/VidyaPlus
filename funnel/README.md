# GATE EC maths diagnostic funnel (v0)

A static site plus one Google Apps Script. No server, no database, no cost.

```
outreach message → diagnostic (Cloudflare Pages) → completion ping ─┐
                                   └→ typed @handle unlock ─────────┼→ Apps Script → Registry Sheet
JEE waitlist page ──────────────────────────────────────────────────┘
Registry "Leads" tab → you DM on Telegram → 15-min call (booking link)
```

## Principles

- **Receipts never lie.** A solution's chip says "reviewed by Giri" only when `review/giri-review.json` marks that item reviewed *and* its fingerprint still matches the item. Otherwise it says "review pending" and the page shows a preview banner.
- **Every key is recomputed.** `build/build_diagnostic.py` holds an independent SymPy check per item that evaluates every option. Exactly one must be true and it must equal the key, or the build fails.
- **Nothing personal until the student chooses.** Completion pings are anonymous. A Telegram username is stored only on unlock, with an 18+ consent tick.
- **Visitor input is data, never formulas.** The webhook writes every cell with a leading `'`.

## Layout

- `build/`: builds `site/data/diagnostic.json` from the GATE EM bank.
- `review/giri-review.json`: your sign-off per item.
- `site/`: everything Cloudflare serves. `config.js` is the only file you edit to wire it up.
- `apps-script/Code.gs`: the webhook.
- `tests/`: `npm test` from this folder (Node 20+, Python 3 + SymPy).

## Go-live runbook (account steps only you can do)

**1. Registry Sheet + webhook (10 min)**
1. Create a Google Sheet named "Vidhya Registry" in your personal Google account.
2. Extensions → Apps Script. Replace `Code.gs` with `funnel/apps-script/Code.gs`. Save.
3. Run `setup` once from the editor (approve the permission prompt). Tabs Completions, Leads and JEE waitlist appear.
4. Deploy → New deployment → Web app. Execute as **Me**, access **Anyone**. Copy the `/exec` URL.
5. Check it: open the URL in a browser; it should show `{"ok":true,"service":"vidhya-funnel",...}`.

**2. Telegram (5 min)**
1. Create a public channel for the daily verified question; note its username.
2. Your own Telegram username goes in `FOUNDER_TELEGRAM` (fallback when the webhook is unreachable).

**3. Fill `site/config.js`**
`WEBHOOK_URL`, `TELEGRAM_CHANNEL`, `FOUNDER_TELEGRAM` (no `@`), `BOOKING_URL` (same link as the tracker's X1), and `SITE_URL` once you know it.

**4. Cloudflare Pages (10 min)**
Workers & Pages → Create → Pages → Upload assets → drag the `funnel/site` folder. (Or connect the GitHub repo with build output directory `funnel/site` and no build command.) Optionally turn on Web Analytics and paste its token into `CF_ANALYTICS_TOKEN`. Put the `*.pages.dev` URL into `SITE_URL` and the outreach tracker.

**5. Smoke test on your phone**
Take the test with a throwaway handle, confirm a row in Completions and one in Leads, then delete both rows.

**6. Before Saturday's send: review and release**
For each item in `review/giri-review.json`, read the question, options and solution in the live preview; set `reviewed: true`, `reviewed_at`, and `hand_solved: true` for any you solved on paper (at least 5). Then:
```
python3 funnel/build/build_diagnostic.py --release
```
It refuses (exit 2) until all 20 are reviewed and 5 hand-solved. Redeploy `funnel/site`. The banner disappears and chips turn solid green.

If you edit an item in the bank later, its fingerprint changes and its chip drops back to "review pending" until you re-review it. That is intended.

**7. Render: set `LANDING_DISABLED=true`** before merging stack patch 08, so the old server landing doesn't compete with this one.

## Daily loop

- Leads tab, `status = new` → DM the handle on Telegram yourself (one-to-one, from your personal account), send the plan, offer the call. Set `status` to `dm-sent`, then `call-booked` / `no-reply`.
- Completions count is the kill-switch number from the plan.

## Not done here

- Browser QA on a real phone (the workspace had no browser; a jsdom run covered the full flow). Run `/browse` or `/qa` against the Pages URL after deploy.
- Telegram bot automation. Unlock DMs are manual on purpose until volume says otherwise.
