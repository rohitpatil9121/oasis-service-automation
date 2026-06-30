# Phone Push Notifications — Setup Guide

Technicians get a phone notification ("New job assigned") the moment a manager
assigns them a ticket — even when the app is closed. Uses Firebase Cloud
Messaging (FCM).

**All the code is already wired.** What's left needs your Google account:
two files from Firebase. Do the steps in order — the migration MUST run before
the new backend is deployed.

---

## Step 1 — Create the Firebase project (5 min)

1. Go to **https://console.firebase.google.com** → **Add project**.
   - Name it e.g. `oasis-globe`. Google Analytics: not needed (turn off).
2. Inside the project, click the **Android** icon ("Add app").
   - **Android package name:** `com.oasisglobe.technician` (must match exactly).
   - Nickname: `Oasis Technician`. App nickname/SHA-1 optional — skip SHA-1.
3. Click **Register app** → **Download `google-services.json`**.

## Step 2 — Drop google-services.json into the app

Put the downloaded file here (exact path):

```
technician-app/android/app/google-services.json
```

That's it — the Android build auto-detects it (no code change). Without this
file the app builds fine but push stays off.

## Step 3 — Get the backend service account key

1. Firebase console → ⚙ **Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → confirm → a `.json` downloads.
3. This single-line-ify it and set as the backend env var (see Step 4).

## Step 4 — Backend env var (Render)

The backend reads the service account from `FIREBASE_SERVICE_ACCOUNT` (the whole
JSON as one string). On Render → your service → **Environment** → **Add**:

- **Key:** `FIREBASE_SERVICE_ACCOUNT`
- **Value:** paste the entire contents of the service-account `.json`
  (Render accepts multi-line values; or paste it minified on one line).

If the var is missing, push is simply skipped — nothing else breaks.

## Step 5 — Run the database migration (BEFORE deploying)

In **Supabase → SQL editor**, run:

```sql
alter table users add column if not exists push_token text;
```

(Also saved at `backend/db/phase4_push_token.sql`.)

> ⚠️ Do this first. The assignment code now reads `users.push_token`; deploying
> before the column exists would break technician assignment.

## Step 6 — Deploy backend + rebuild the APK

1. **Deploy backend** (Render). `firebase-admin` is already in `package.json`,
   so Render installs it on deploy.
2. **Rebuild the APK** now that `google-services.json` is in place:
   ```
   cd technician-app
   bash build-apk.sh https://oasis-service-automation.onrender.com
   ```
3. Install the new APK on the phone, open it, log in. Android will ask for
   notification permission → **Allow**. The app sends its device token to the
   backend automatically.

---

## How to test

1. From the manager dashboard, assign a ticket to the logged-in technician.
2. The technician's phone should get a **"New job assigned"** notification.
3. Tapping it opens that job in the app.

## How it works (for reference)

- App: `src/lib/push.js` registers with FCM, sends the device token to
  `POST /api/tech/push-token` (stored in `users.push_token`).
- Backend: `services/push.js` sends via `firebase-admin`; `assignment.js`
  fires the push right after the WhatsApp assignment message.
- Trigger: **new job assignment only** (as requested).
