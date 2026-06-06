# Deploying the server to Render (free, no card)

The app calls this server; Render runs it 24/7 at a free `https://` URL.
Your API key is set as a Render **environment variable** — never committed to git.

---

## Step 1 — Put the code on GitHub

1. Create a free GitHub account (no card): https://github.com/signup
2. Create a new **empty** repository (e.g. `ReminderApp`) — keep it **Private**.
3. From your Mac, push the project (commands provided in chat).

> `.gitignore` already excludes `node_modules/`, `venv/`, and `.env`, so your
> secret `.env` and big folders are NOT uploaded.

---

## Step 2 — Deploy on Render

1. Go to https://render.com → **Get Started** → **Sign in with GitHub** (no card).
2. **New +** → **Blueprint** → pick your `ReminderApp` repo.
3. Render reads `render.yaml` and sets everything up. It will ask for the secret:
   - **ANTHROPIC_API_KEY** → paste your real key.
4. Click **Apply / Create**. Render builds and starts the service (~2–3 min).
5. When it's live, copy the URL — it looks like:
   `https://billserver-xxxx.onrender.com`
6. Verify: open `https://billserver-xxxx.onrender.com/health` in a browser →
   should show `{"status":"ok","model":"claude-sonnet-4-6","mock":false}`.

---

## Step 3 — Point the app at Render

In `mobile/config.ts`, set:
```ts
export const SERVER_URL = "https://billserver-xxxx.onrender.com";
```
Restart Expo, reload the app, scan a bill — it now uses the cloud server.

---

## Step 4 (optional) — Avoid the cold start

Render's free service sleeps after ~15 min idle (first scan then waits ~30–50s).
Keep it awake for free with an uptime pinger:
1. https://uptimerobot.com (free) → add an **HTTP(s) monitor**
2. URL: `https://billserver-xxxx.onrender.com/health`, interval **5 min**

---

## Notes
- The key lives only in Render's env settings + your local `.env`. Never in git.
- Updating the server later = `git push`; Render auto-redeploys.
