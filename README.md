# Bill Reminder 🧾

Snap a photo of any bill, receipt, or report. AI reads it, figures out the
action and date (next service, return window, renewal…), and sets a calendar
reminder **2 days before**.

## What's inside

```
ReminderApp/
├── mobile/    The Android app — TypeScript (React Native / Expo)
│              This is what becomes the .apk you install on your phone.
└── server/    A small Python API (FastAPI) that holds the AI key and
               reads the bills with Claude. Runs on your Mac for testing,
               and later on Oracle Cloud (free).
```

The app (TypeScript) and the server (Python) are **separate programs** that talk
over the internet. The app never contains the AI key — the server does.

## The flow

```
Take photo → app sends it to the server → server asks Claude to read it
  → returns {item, action, date} → you confirm → app creates a calendar
  event with an alert 2 days before → your calendar reminds you later.
```

---

## How to run it (local testing)

You need **two terminals** open. Your **phone and Mac must be on the same Wi-Fi**.

### Terminal 1 — start the server

```bash
cd server
cp .env.example .env          # then open .env and paste your real Anthropic key
venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```

(The Python environment is already installed in `server/venv`.)

### Terminal 2 — start the app

```bash
cd mobile
npx expo start
```

Then on your phone:
1. Install **Expo Go** from the Play Store.
2. Open Expo Go → **Scan QR code** → scan the QR shown in Terminal 2.
3. The app loads. Tap **Take a photo**, snap a bill, and follow along.

> If the app can't reach the server, check that `SERVER_URL` in
> `mobile/config.ts` matches your Mac's Wi-Fi IP.

---

## Going live (later)

- **Server → Oracle Cloud:** see [server/DEPLOY_ORACLE.md](./server/DEPLOY_ORACLE.md).
  Then change `SERVER_URL` in `mobile/config.ts` to your `https://` address.
- **App → real APK:** `cd mobile && eas build -p android --profile preview`
  (builds a `.apk` in the cloud you can install directly).
