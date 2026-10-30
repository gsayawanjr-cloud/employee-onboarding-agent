# Onboarding automation: setup

Everything below is free. Allow about 30 minutes. Fill in `.env` as you go (each line has a comment).

## 1. Trigger.dev project (new one, just for this)
1. cloud.trigger.dev → **New project** → name it "Employee onboarding".
2. Copy the project ref (`proj_...`) into `trigger.config.ts` (replace `proj_REPLACE_ME`).
3. API keys → copy the **dev** secret key into `.env` → `TRIGGER_SECRET_KEY`.

## 2. Google Sheet + policy folder
1. Create a blank Google Sheet named "Onboarding tracker". Put its ID in `ONBOARDING_SHEET_ID`.
2. Create a Drive folder "Approved policies". Upload the 5 files from `policies/`. Put the folder ID in `POLICY_DRIVE_FOLDER_ID`.
3. Service account: you can reuse the key from another of your projects, or create a new one
   (Google Cloud → IAM → Service accounts). Enable the **Google Sheets API** and **Google Drive API** on its project.
   Paste the key JSON (one line) into `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. Share the sheet (**Editor**) and the folder (**Viewer**) with the service account's `client_email`.

## 3. Gmail
1. Pick the Gmail that sends everything → `ONBOARDING_GMAIL_USER`.
2. Create an app password named "onboarding" → `ONBOARDING_GMAIL_APP_PASSWORD`.
3. `ALERT_EMAIL_TO` = where you want failure alerts.
All dummy people are `+aliases` of this Gmail (e.g. `you+dana@gmail.com` is the Sales Director), so every email lands in your inbox.
Filter by "to:you+dana@gmail.com" to see one person's mail.

## 4. Claude key
console.anthropic.com → API keys → `ANTHROPIC_API_KEY`. Used only for policy questions (~1 cent each).

## 5. Approval relay (Cloudflare Worker)
1. Sign up free at dash.cloudflare.com.
2. In this folder: `npx wrangler login`
3. Set the Worker's secrets (each command asks you to paste the value):
   - `npx wrangler secret put APPROVAL_LINK_SECRET --config relay/wrangler.toml`: paste the value already in `.env`
   - `npx wrangler secret put TRIGGER_DEV_SECRET_KEY --config relay/wrangler.toml`: paste your `tr_dev_...` key
4. `npm run relay:deploy` → copy the `https://onboarding-approvals.<you>.workers.dev` URL into `APPROVAL_RELAY_URL`.

## 6. Run it (demo speed)
`DEMO_TIME_SCALE=720` makes waits fast: reminder at 2 min, escalation at 4 min, stalled at 10 min.

1. `npx trigger.dev@latest dev` (restart it whenever you change `.env`).
2. Trigger `onboarding-self-test` (free, no accounts needed).
3. Trigger `onboarding-setup-sheet` → creates all tabs and 4 demo offers.
4. In the **Offers** tab, set **Offer Status = Signed** on any rows. Within 15 minutes (or trigger
   `onboarding-check-offers` from the dashboard right away) onboarding starts.
   OF-1004 (role "Marketing") is meant to fail: it goes to "Needs HR review".
5. Watch your inbox: approve some, reject one, ignore one to see reminder → escalation → stalled.
6. Policy questions: trigger `onboarding-send-test-questions`, then `onboarding-policy-inbox`.
7. Trigger `onboarding-daily-digest` to see the manager emails.

To redo a demo, delete the data rows in Offers/Hires/Tasks/Approvals and run `onboarding-setup-sheet` again.
A withdrawn then re-signed offer needs a **new Offer ID** (the old one is permanently linked to its cancelled run).

## 7. Going live (only after you approve the deploy)
- Add every `.env` value to cloud.trigger.dev → Environment Variables (staging + prod). A production
  deploy uploads them automatically, except `TRIGGER_SECRET_KEY` and `DEMO_TIME_SCALE`.
- `npx wrangler secret put TRIGGER_PROD_SECRET_KEY --config relay/wrangler.toml`: paste the prod key.
- Change `TIMEZONE` in `src/trigger/onboarding/config/company.ts` so the digest arrives at 8am your time.

## Changing the company
Roles, checklists, people, owners and timings are all in `src/trigger/onboarding/config/company.ts`.
