# Oasis Globe — Service Automation Platform (Phase 1)

A WhatsApp-first service system. Every customer request is captured on WhatsApp,
validated, saved as a tracked ticket, and assigned to a technician from a
manager dashboard — with WhatsApp notifications at each step. Built so **no
inquiry is ever lost**.

> Phase 1 scope only: **Service Request Ingestion** + **Technician Assignment**.
> Stock, scheduling, invoicing, payments and incentives are intentionally out of scope.

---

## 1. What's included

| Capability | Status |
|---|---|
| WhatsApp AI intake flow (Name → Phone → Address → Issue, in order) | ✅ |
| Mandatory-field validation (cannot complete until all 4 captured) | ✅ |
| Ticketing with `NEW / ASSIGNED / IN_PROGRESS / CLOSED / CANCELLED` | ✅ |
| Full audit trail (every status change + assignment logged) | ✅ |
| Manager dashboard: live inbox, ticket detail, assign, status, history | ✅ |
| Manual technician assignment + technician WhatsApp alert | ✅ |
| Notifications: customer confirm, manager alert, technician alert | ✅ |
| Customer "technician assigned" update + `status` tracking command | ✅ |
| Manager alerts to **all active managers** (users table) + `MANAGER_WHATSAPP` | ✅ |
| Raw inbound message log (`wa_inbound`) — inquiry survives any error | ✅ |
| Notification **outbox + worker** (queue-ready, retries, never lost) | ✅ |
| Roles: Owner / Manager / Technician / Customer + RBAC groundwork | ✅ |
| Auth: phone + password **and** WhatsApp OTP (JWT) | ✅ |
| Twilio WhatsApp with a **mock mode** so it runs with zero credentials | ✅ |

---

## 2. Architecture

```
WhatsApp user ──▶ Twilio ──▶ POST /webhook/whatsapp
                                   │
                          intake state machine (services/intake.js)
                                   │  (validates & advances field by field)
                                   ▼
                          createTicket() ──▶ Supabase (customers, tickets, events)
                                   │
                          notifications outbox ──▶ queue ──▶ worker ──▶ Twilio
                                                                 (mock or live)

Manager browser ──▶ React dashboard ──▶ REST API (/api/*) ──▶ Supabase
```

Tech stack: **Node.js + Express**, **Supabase (PostgreSQL)**, **Twilio WhatsApp**,
**React + Vite + Tailwind**. JWT auth. In-process queue with a standalone worker
(swap for BullMQ/SQS in Phase 2 without touching callers).

---

## 3. Folder structure

```
oasis-globe/
├── backend/
│   ├── db/
│   │   ├── schema.sql          # tables, enums, sequence, triggers
│   │   ├── policies.sql        # RLS groundwork for Phase 2
│   │   └── seed.sql            # owner/manager/technicians (pwd: password123)
│   ├── scripts/
│   │   ├── hash.js             # generate a bcrypt hash
│   │   └── smoke.js            # quick helper sanity check
│   └── src/
│       ├── index.js            # entry — starts the HTTP server
│       ├── app.js              # express app wiring
│       ├── config/             # env.js, supabase.js
│       ├── lib/                # logger.js, phone.js
│       ├── middleware/         # auth (JWT), rbac, errorHandler
│       ├── services/           # whatsapp, notifications, tickets,
│       │                       #   intake (state machine), assignment, auth
│       ├── routes/             # auth, tickets, technicians, webhook
│       ├── queue/queue.js      # in-process job queue (queue-ready)
│       └── workers/            # notificationWorker.js (retry loop)
└── frontend/
    └── src/
        ├── api/client.js       # fetch wrapper
        ├── context/AuthContext.jsx
        ├── components/         # Layout, StatusBadge, TicketTable, AssignModal
        └── pages/              # Login, Dashboard, TicketView
```

---

## 4. Database schema (summary)

- **users** — staff (owner/manager/technician): `phone` (unique), `password_hash`,
  `role`, OTP fields.
- **customers** — WhatsApp requesters: `full_name`, `phone` (unique), `address`.
- **tickets** — `ticket_number` (auto `OG-1001…`), `customer_id`, `issue_description`,
  `status`, `assigned_technician_id`, `source`.
- **assignments** — assignment history (who, by whom, when, note).
- **ticket_events** — audit log (created / status_changed / assigned).
- **intake_sessions** — WhatsApp conversation state per phone (one active at a time).
- **notifications** — outbox: `recipient`, `body`, `status` (PENDING/SENT/FAILED),
  `provider_sid`, retries.
- **wa_inbound** — raw log of every inbound WhatsApp message, written before any
  processing so no inquiry is ever lost.

Full DDL in `backend/db/schema.sql`.

---

## 5. API design

All `/api/*` routes require `Authorization: Bearer <jwt>` except auth endpoints.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — | Phone + password → JWT |
| POST | `/api/auth/otp/request` | — | Send WhatsApp OTP |
| POST | `/api/auth/otp/verify` | — | OTP → JWT |
| GET  | `/api/auth/me` | any | Current user |
| GET  | `/api/tickets?status=` | owner, manager | Live inbox / list |
| GET  | `/api/tickets/:id` | staff | Ticket detail |
| GET  | `/api/tickets/:id/history` | staff | Events + assignments |
| POST | `/api/tickets` | owner, manager | Manual ticket |
| POST | `/api/tickets/:id/assign` | owner, manager | Assign technician |
| PATCH| `/api/tickets/:id/status` | owner, manager | Change status |
| GET  | `/api/technicians` | owner, manager | Technician list |
| POST | `/webhook/whatsapp` | Twilio | Inbound WhatsApp |
| GET  | `/health` | — | Health check |

---

## 6. WhatsApp intake flow

Deterministic state machine in `services/intake.js`:

```
(no session) ─▶ greet + ask NAME
AWAITING_NAME ─▶ save name ─▶ ask PHONE   (reply "same" = use WhatsApp number)
AWAITING_PHONE ─▶ validate ─▶ ask ADDRESS
AWAITING_ADDRESS ─▶ save ─▶ ask ISSUE
AWAITING_ISSUE ─▶ all 4 present? ─▶ create ticket, return OG-#### ─▶ COMPLETED
```

Guards: each step re-prompts on empty/invalid input and **never advances or
completes** until the field is valid. Send `restart` / `cancel` to reset.
Outside an active intake, send `status` / `track` to get the latest ticket's
status and assigned technician.

---

## 7. Setup — run it locally

### Prerequisites
- Node.js 18+ (tested on 22)
- A Supabase project (free tier is fine)

### A. Database
1. Open your Supabase project → **SQL Editor**.
2. Paste and run `backend/db/setup_all.sql` (schema + policies + seed in one go).
   Or run the three files individually: `schema.sql`, `policies.sql`, `seed.sql`.
   - Seed creates Owner `+918668732890`, Manager `+919000000001`, three technicians.
   - Owner & Manager password = `password123` (change it!). Generate a new hash with
     `node backend/scripts/hash.js <newpassword>` and update the row.

### B. Backend
```bash
cd backend
cp .env.example .env        # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + JWT_SECRET
npm install
npm run dev                 # API on http://localhost:3000
npm run worker              # (separate terminal) drains the notification outbox
```
Leave `WHATSAPP_MOCK=true` to run with **no Twilio** — outgoing messages are logged
to the console and the webhook returns the reply as JSON so you can test with curl:
```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -d "From=whatsapp:+919812345678" -d "Body=hi"
```

### C. Frontend
```bash
cd frontend
cp .env.example .env        # leave VITE_API_BASE blank to use the dev proxy
npm install
npm run dev                 # dashboard on http://localhost:5173
```
Log in with the Manager phone `+919000000001` / `password123`, or use the **OTP**
tab (the code is logged to the backend console in mock mode).

### D. Going live with real WhatsApp (Twilio)
1. In `backend/.env` set `WHATSAPP_MOCK=false` and fill `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (sandbox `whatsapp:+14155238886`).
2. Expose your backend (e.g. `ngrok http 3000`) and set `PUBLIC_BASE_URL`.
3. In the **Twilio Console → WhatsApp Sandbox**, set "When a message comes in" to
   `https://<your-url>/webhook/whatsapp` (POST).
4. Set `MANAGER_WHATSAPP` to the number that should receive new-request alerts.
5. Join the sandbox from your phone, message it, and watch a ticket appear in the dashboard.

---

## 8. What YOU need to do after handover

1. **Create a Supabase project** and run the three SQL files (Section 7A).
2. **Fill `backend/.env`** with your Supabase URL + service-role key and a strong `JWT_SECRET`.
3. **Change the seed password** and add your real technicians (update `users` rows).
4. **Run `npm install`** in both `backend/` and `frontend/` (deps are NOT bundled).
5. **Test in mock mode** first (`WHATSAPP_MOCK=true`) using the curl command above.
6. **Connect Twilio** when ready (Section 7D) and point the sandbox webhook at your URL.
7. Optionally deploy: backend to Render/Railway/Fly, frontend to Vercel/Netlify; run
   the worker as a separate process.

---

## 9. Ready for Phase 2

The structure already anticipates the next phase: RBAC permission map
(`middleware/rbac.js`), RLS scaffolding (`db/policies.sql`), a swappable queue
abstraction (`queue/queue.js`), an event/audit table, and a `source` field on
tickets. Rules-based auto-assignment, scheduling, stock, invoicing and incentives
can be layered on without reworking the foundation.
