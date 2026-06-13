# Deploying Oasis Globe

Architecture split:
- **Backend** (`/backend`, Express API) → **Render Web Service**
- **Frontend** (`/frontend`, Vite/React static site) → **Vercel**

Prerequisites: code pushed to a GitHub repo, a Supabase project, and Meta WhatsApp Cloud API (or Twilio) credentials.

---

## Part A — Backend on Render

### 1. Create the Web Service
1. Go to https://dashboard.render.com → **New** → **Web Service**.
2. Connect your GitHub repo (`oasis-globe`).
3. Configure:
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free (or paid for no cold starts)

### 2. Environment variables
Add these under **Environment** (copy values from `backend/.env.example`):

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | a long random string |
| `JWT_EXPIRES_IN` | `7d` |
| `OTP_TTL_SECONDS` | `300` |
| `SUPABASE_URL` | your Supabase URL |
| `SUPABASE_ANON_KEY` | your anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | your service-role key |
| `WHATSAPP_MOCK` | `false` (real sends) or `true` (log only) |
| `WHATSAPP_PROVIDER` | `meta` (or `twilio`) |
| `META_PHONE_NUMBER_ID` | from Meta → WhatsApp → API Setup |
| `META_ACCESS_TOKEN` | a System User token (never expires) |
| `META_VERIFY_TOKEN` | any string you choose (used in the Meta callback) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | only if `WHATSAPP_PROVIDER=twilio` |
| `AI_INTAKE` | `true` for the Groq AI agent |
| `GROQ_API_KEY` | from console.groq.com (if `AI_INTAKE=true`) |
| `MANAGER_WHATSAPP` | `+91XXXXXXXXXX` |
| `DEFAULT_COUNTRY_CODE` | `+91` |
| `CORS_ORIGIN` | **your Vercel URL** (fill in after Part B) |
| `PUBLIC_BASE_URL` | **your Render URL** (e.g. `https://oasis-globe-api.onrender.com`) |

> Do **not** set `PORT` — Render injects it, and the app already reads `process.env.PORT`.

### 3. Deploy
Click **Create Web Service**. After it builds, note the URL, e.g.
`https://oasis-globe-api.onrender.com`. Test: visit `/` or any health route.

### 4. WhatsApp webhook
In **Meta → your app → WhatsApp → Configuration**, set the Callback URL to
`https://<your-render-url>/webhook/whatsapp` and the Verify token to your
`META_VERIFY_TOKEN`, then subscribe to the **messages** field.
(For Twilio, set the sandbox/number webhook to the same URL.)

---

## Part B — Frontend on Vercel

### 1. Import the project
1. Go to https://vercel.com → **Add New** → **Project** → import the repo.
2. Configure:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (auto-detected)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

### 2. Environment variable
Add:

| Key | Value |
|-----|-------|
| `VITE_API_BASE` | your Render backend URL, e.g. `https://oasis-globe-api.onrender.com` |

> The frontend calls `${VITE_API_BASE}/api/...`. Leaving it blank only works with the local dev proxy, so it **must** be set in production.

### 3. Deploy
Click **Deploy**. Note the URL, e.g. `https://oasis-globe.vercel.app`.

---

## Part C — Wire the two together

1. Back in **Render**, set `CORS_ORIGIN` to your exact Vercel URL
   (e.g. `https://oasis-globe.vercel.app` — no trailing slash). Save → it redeploys.
   - For multiple origins, comma-separate them (the app splits on `,`).
2. Confirm Render's `PUBLIC_BASE_URL` is its own URL.
3. Open the Vercel site, log in, and verify API calls succeed (check browser
   DevTools → Network for CORS or 404 errors).

---

## Quick reference

| Piece | Host | Root dir | Start command | Key env |
|-------|------|----------|---------------|---------|
| Backend API | Render Web Service | `backend` | `npm start` | `CORS_ORIGIN`, `PUBLIC_BASE_URL`, Supabase keys, `META_*` |
| Frontend | Vercel | `frontend` | (build) `npm run build` | `VITE_API_BASE` |

### Common gotchas
- **CORS errors:** `CORS_ORIGIN` on Render must exactly match the Vercel domain (no trailing slash).
- **Frontend hits localhost:** `VITE_API_BASE` wasn't set at build time — redeploy after adding it.
- **Free Render cold starts:** first request after idle takes ~30s. Upgrade or use a pinger if needed.
- **Custom domains:** after adding one, update `CORS_ORIGIN` and `VITE_API_BASE` accordingly.
