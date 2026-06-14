# Oasis Globe — Software Design Document (Phase 1)

**Service Center Automation — WhatsApp-first intake & technician assignment**

_Status: Phase 1 built & live. Version 1.0 · 2026-06-14_

This is the technical deep-dive the Project Plan calls for as its "next step":
data model, WhatsApp agent conversation design, API contracts, and the Phase 1
backlog. It documents what is **actually built** in `backend/` + `frontend/`.

---

## 1. Scope

| Phase | Scope | This doc |
|-------|-------|----------|
| **Phase 1** | Service Request Ingestion · Technician Assignment | ✅ covered |
| Phase 2 | Stock · Scheduling · Execution | roadmap only (§10) |
| Phase 3 | Invoice · Payment · Incentives | roadmap only (§10) |

**Phase 1 goal:** zero lost requests. Every WhatsApp inquiry becomes a tracked
ticket; a manager assigns a technician; all three parties get WhatsApp updates.

---

## 2. Architecture

```
  Customer (WhatsApp)
        │  message
        ▼
  Meta WhatsApp Cloud API ──► POST /webhook/whatsapp
        ▲                          │
        │ reply / alerts           ▼
        │                   ┌──────────────────┐
        │                   │  Node/Express API │
        │  templates ◄──────│  (Render)         │
        │                   └────────┬─────────┘
                                     │ Supabase JS (service-role)
                                     ▼
                              PostgreSQL (Supabase)
                                     ▲
                                     │ REST + JWT
                            ┌────────┴─────────┐
                            │ React dashboard  │  ← Manager / Owner
                            │ (Vercel)         │
                            └──────────────────┘
        AI intake: Groq LLM (gpt-oss-120b) extracts name/address/issue
```

**Two intake engines**, toggled by `AI_INTAKE`:
- `services/aiIntake.js` — Groq LLM conversational agent (**live**).
- `services/intake.js` — deterministic state machine (fallback).

---

## 3. Tech stack

| Layer | Choice |
|-------|--------|
| Customer channel | WhatsApp Business Cloud API (Meta, official) |
| AI intake | Groq LLM, model `openai/gpt-oss-120b` |
| Backend | Node.js + Express (ES modules) |
| Database | PostgreSQL via Supabase (service-role key, server-side only) |
| Auth | JWT (phone+password) + WhatsApp OTP |
| Frontend | React + Vite + Tailwind, React Router |
| Hosting | Backend → Render · Frontend → Vercel |

---

## 4. Data model

All tables live in Supabase Postgres. Columns below reflect actual code usage.

### `customers`
| Column | Notes |
|--------|-------|
| `id` (uuid, pk) | |
| `full_name` | |
| `phone` | unique, normalised E.164 (`+91…`) — natural key for returning customers |
| `address` | technician visit address |
| `created_at` | |

### `users` (staff: owner / manager / technician)
| Column | Notes |
|--------|-------|
| `id` (uuid, pk) | |
| `full_name`, `phone`, `email` | `phone` unique |
| `role` | `owner` \| `manager` \| `technician` |
| `is_active` | inactive users can't log in / be assigned |
| `password_hash` | bcrypt; null for OTP-only staff |
| `otp_code`, `otp_expires_at` | hashed OTP, single-use |

### `tickets`
| Column | Notes |
|--------|-------|
| `id` (uuid, pk) | |
| `ticket_number` | `OG-DDMMYY-XXXX`, per-day sequence (IST), set by DB trigger |
| `customer_id` → customers | |
| `issue_description` | |
| `source` | `whatsapp` \| `manual` |
| `status` | `NEW` → `ASSIGNED` → `IN_PROGRESS` → `CLOSED` (`CANCELLED`) |
| `assigned_technician_id` → users | |
| `created_by` → users | null for WhatsApp-originated |
| `created_at` | |

### `assignments` (assignment history)
`id`, `ticket_id`, `technician_id`, `assigned_by`, `note`, `assigned_at`

### `ticket_events` (audit log — every state change)
`id`, `ticket_id`, `event_type` (`created`/`assigned`/`status_changed`),
`from_status`, `to_status`, `actor_id`, `meta` (jsonb), `created_at`

### `notifications` (outbound WhatsApp outbox / audit)
`id`, `channel`, `recipient`, `body`, `audience`, `related_ticket_id`,
`status` (`SENT`/`FAILED`), `attempts`, `sent_at`, `provider_sid`, `last_error`
> Sent **inline** and stored as already-`SENT` — no `PENDING` row (see §7).

### `intake_sessions` (in-progress WhatsApp conversations)
`id`, `phone`, `state`, `data` (jsonb: `{collected, history, returning}`),
`customer_id`, `ticket_id`, `created_at`

### `wa_inbound` (raw inbound log — nothing is ever lost)
`id`, `from_phone`, `body`, `created_at` — written **before** intake runs.

### Key DB logic — `set_ticket_number` trigger
`BEFORE INSERT` on tickets. Generates `OG-DDMMYY-XXXX` using
`max(seq)+1` per day under an advisory lock (not `count(*)`, which collided
after deletions). See `backend/db/migration_ticket_number.sql`.

---

## 5. WhatsApp conversation design (AI intake)

Engine: `services/aiIntake.js` + `services/ai.js` (Groq).

**Goal:** extract `name`, `address`, `issue` from natural conversation. Phone
comes from the WhatsApp sender — never asked.

- **Extraction-first prompt.** Every model reply is strict JSON:
  `{"fields": {name?, address?, issue?}, "message": "..."}`. `fields` carries
  newly-extracted data; `message` is the WhatsApp reply. (Function-call style was
  unreliable with this model — extraction-first + a worked example fixed it.)
- **`mergeFields()`** merges only the three known string fields into session state.
- **Mandatory-field gate:** a ticket is created only when
  `name && address && issue` are all present → **no request closes incomplete**.
- **Returning customers:** looked up by phone on first turn; name+address
  pre-filled, agent confirms instead of re-asking, only re-captures changes.
- **Commands:** `status`/`track` → latest ticket status; `restart`/`reset`/
  `cancel`/`start over` → fresh session.
- **Resilience:** raw inbound logged to `wa_inbound` first; LLM errors return a
  friendly retry, session stays open, nothing is lost.

**Happy path:** message → (log) → LLM extract → fields complete → `createTicket`
→ customer confirmation + manager alert → reply with ticket number.

---

## 6. API contracts

Base: `/api`. All non-auth routes require `Authorization: Bearer <JWT>`.
RBAC via `requireRole(...)`. Errors: `{ error, ...}` with appropriate status.

### Auth
| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/auth/login` | `{phone, password}` | `{token, user}` |
| POST | `/auth/otp/request` | `{phone}` | `{message}` (no account disclosure) |
| POST | `/auth/otp/verify` | `{phone, code}` | `{token, user}` |
| GET | `/auth/me` | — | `{user}` |

`user` = `{id, full_name, phone, role}`.

### Tickets (owner/manager; read also technician)
| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/tickets?status=` | — | `{tickets}` |
| GET | `/tickets/:id` | — | `{ticket}` |
| GET | `/tickets/:id/history` | — | `{events, assignments}` |
| POST | `/tickets` | `{full_name, phone, address, issue_description}` | `{ticket}` (201) |
| POST | `/tickets/:id/assign` | `{technician_id, note?}` | `{ticket}` |
| PATCH | `/tickets/:id/status` | `{status}` | `{ticket}` |

### Technicians (owner/manager)
| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/technicians` | — | `{technicians}` (active only) |
| POST | `/technicians` | `{full_name, phone, email?}` | `{technician}` (201) |

### Webhook (Meta)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/webhook/whatsapp` | Meta verification (`hub.challenge`) |
| POST | `/webhook/whatsapp` | Inbound messages → intake → reply |

`GET /health` → `{ok, service, mock}` for uptime checks.

---

## 7. Notification design (24-hour rule + templates)

`services/notifications.js` sends **inline** and stores the final state
(`SENT`/`FAILED`) — deliberately **no `PENDING` row** (a shared Supabase project
once had another worker draining pending rows via the wrong provider).

**Meta's 24-hour window:** free-form text only reaches someone who messaged the
business in the last 24h. So:
- **Customer** replies/confirmations → free-form (they're mid-conversation). ✅
- **Staff** alerts (manager, technician) → **approved templates** (bypass window).

**Template registry:** `services/waTemplates.js` defines `manager_new_request`
and `technician_new_job` — each returns `{template:{name,language,variables}, body}`.
`queueNotification({…, template})` sends the template via Meta and falls back to
`body` text for mock/Twilio. Variables are sanitised (no newlines/empty).
Submission guide: [`docs/whatsapp-templates.md`](whatsapp-templates.md).

---

## 8. Roles & permissions

`middleware/rbac.js`. JWT carries the role; `requireRole(...)` guards routes.

| Role | Capability (Phase 1) |
|------|----------------------|
| **Owner** | Full view; manage users; everything managers can do |
| **Manager** | Inbox, create/assign tickets, change status, manage technicians |
| **Technician** | Read own assigned tickets (write deferred to Phase 2) |
| **Customer** | No dashboard; interacts only via WhatsApp |

---

## 9. Ticket lifecycle

```
   NEW ──assign──► ASSIGNED ──work──► IN_PROGRESS ──done──► CLOSED
    │                                                         
    └────────────────────── CANCELLED ───────────────────────
```
Every transition writes a `ticket_events` row (audit). Assignment also writes an
`assignments` row and notifies technician + customer.

---

## 10. Deployment

| Piece | Where | Notes |
|-------|-------|-------|
| Backend | Render (auto-deploy `main`) | env vars incl. Meta System-User token |
| Frontend | Vercel (auto-deploy `main`) | needs `vercel.json` SPA rewrite |
| DB | Supabase | run `db/migration_ticket_number.sql` once |
| Webhook | Meta → Render `/webhook/whatsapp` | verify token in env |

Secrets are env-based; see `backend/.env.example`. Credentials are kept in the
git-ignored `CREDENTIALS.md` (never committed).

---

## 11. Phase 1 status & remaining

**Built & verified:** AI intake → tracked ticket → manager panel (live inbox,
search, filters) → manual assignment → WhatsApp notifications → roles/RBAC →
add-technician (UI + API) → staff-alert templates (code ready).

**Remaining housekeeping (not blocking Phase 2):**
1. Submit + approve the two WhatsApp templates in Meta (§7 / templates doc).
2. Rotate the leaked Supabase service-role + Twilio tokens.
3. Change the default dashboard password.
4. Add real technicians (replace the fake `+9190000000xx` seeds).

---

## 12. Phase 2 / 3 roadmap (pointers)

- **Phase 2 — Stock, Schedule, Service:** `stock_items`, `stock_issues`,
  reconciliation + variance flags; slot scheduling over WhatsApp; technician
  execution states (`IN_PROGRESS` lifecycle) with customer notifications.
  Technician write-access (currently read-only) gets enabled here.
- **Phase 3 — Invoice, Payment, Incentives:** GST invoice service; multi-mode
  payment (UPI/link/cash) reconciled per job; configurable incentive engine;
  owner analytics dashboard.

The Phase 1 foundations — data model, roles, audit log (`ticket_events`),
notification pipeline — are designed to extend into these without rework.
