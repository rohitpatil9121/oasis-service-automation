# WhatsApp Message Templates — Staff Alerts (24-hour fix)

This is the exact content to submit in **Meta Business Manager** so technician &
manager alerts deliver reliably. Read the "why" once, then just copy-paste.

---

## Why we need this (the 24-hour rule)

WhatsApp lets a business send **free-form text only within 24 hours** of the
person last messaging the business. Technicians and managers usually **haven't
messaged** the business number, so their free-form alerts silently fail to
deliver.

**Pre-approved templates bypass this window** — they can be sent any time.
So staff alerts go out as templates; customer replies (who are mid-conversation)
stay as normal text.

The backend is **already wired** to send these templates (see
`backend/src/services/waTemplates.js`). It will start working the moment the two
templates below are **approved** in Meta and their names match exactly.

---

## Where to create them

1. Go to **business.facebook.com** → **WhatsApp Manager**
   (or developers.facebook.com → your app → WhatsApp → **Message Templates**).
2. Click **Create template**.
3. For each template below set:
   - **Category:** `Utility` (NOT Marketing — Utility approves faster & is for transactional alerts)
   - **Name:** exactly as given (lowercase, underscores)
   - **Language:** `English` (code `en`)
4. Paste the **Body** text exactly (keep the `{{1}}` … `{{5}}` placeholders).
5. Fill the **sample values** (Meta needs them to approve) — use the samples given.
6. Submit. Approval is usually minutes to a few hours.

> ⚠️ The template **name** and **language code** must match the code exactly.
> If you pick language "English (US)" the code becomes `en_US` — then update
> `WA_LANG` in `backend/src/services/waTemplates.js` to `"en_US"`.

---

## Template 1 — `manager_new_request`

Sent to the Service Manager(s) when a new request comes in.

- **Name:** `manager_new_request`
- **Category:** `Utility`
- **Language:** `English` (`en`)

**Body:**
```
🆕 New service request {{1}}

Customer: {{2}} ({{3}})
Address: {{4}}
Issue: {{5}}

Please open the Oasis Globe dashboard to assign a technician.
```

**Sample values (for approval):**
| Variable | Meaning | Sample |
|----------|---------|--------|
| {{1}} | Ticket number | `OG-140625-0001` |
| {{2}} | Customer name | `Mohit Sharma` |
| {{3}} | Customer phone | `+919812345678` |
| {{4}} | Address | `12 Shivaji Nagar, Pune 411005` |
| {{5}} | Issue | `Kent RO purifier leaking badly` |

---

## Template 2 — `technician_new_job`

Sent to the assigned technician when the manager assigns them a ticket.

- **Name:** `technician_new_job`
- **Category:** `Utility`
- **Language:** `English` (`en`)

**Body:**
```
🔧 New job assigned to you — {{1}}

Customer: {{2}} ({{3}})
Address: {{4}}
Appliance: {{5}}
Issue: {{6}}

Please contact the customer and proceed with the visit.
```

**Sample values (for approval):**
| Variable | Meaning | Sample |
|----------|---------|--------|
| {{1}} | Ticket number | `OG-140625-0001` |
| {{2}} | Customer name | `Mohit Sharma` |
| {{3}} | Customer phone | `+919812345678` |
| {{4}} | Address | `12 Shivaji Nagar, Pune 411005` |
| {{5}} | Appliance | `Split AC 1.5 ton` |
| {{6}} | Issue | `AC not cooling` |

> Note: appliance can be blank for some tickets — the code sends `—` in that
> case (Meta rejects empty variables), so the message still goes through.

---

## Template 3 — `visit_scheduled_technician`

Sent to the assigned technician when the manager schedules/reschedules the visit.

- **Name:** `visit_scheduled_technician` · **Category:** `Utility` · **Language:** `English` (`en`)

**Body:** (must NOT end with a variable, and needs enough static text — Meta rejects too-many-variables-for-length)
```
New visit scheduled for ticket {{1}}.

Customer: {{2}} ({{3}})
When: {{4}}
Address: {{5}}

Please contact the customer and complete the service on time.
```
Samples: {{1}} `OG-140625-0001`, {{2}} `Mohit Sharma`, {{3}} `+919812345678`, {{4}} `14 Jun 2026, 9:00 am – 11:00 am`, {{5}} `12 Shivaji Nagar, Pune`

## Template 4 — `visit_scheduled_customer`

Sent to the customer with their confirmed slot.

- **Name:** `visit_scheduled_customer` · **Category:** `Utility` · **Language:** `English` (`en`)

**Body:** (must NOT end with a variable)
```
Hi {{1}}, your Oasis Globe service visit is scheduled for {{2}} (Ref {{3}}). Our technician will reach you then. Thank you!
```
Samples: {{1}} `Mohit Sharma`, {{2}} `14 Jun 2026, 9:00 am – 11:00 am`, {{3}} `OG-140625-0001`

## Template 5 — `login_otp`

Sent to staff (technicians/managers) when they request a login OTP. They haven't
messaged the business, so the code can't go as free-form text — this template
delivers it. Now wired in `backend/src/services/auth.js`.

- **Name:** `login_otp` · **Category:** `Authentication` · **Language:** `English` (`en`)

Meta rejects login codes under Utility — pick **Authentication**. You don't type
the body; Meta generates it. Just configure:

- **Code delivery:** `Copy code` button (default).
- **Add security recommendation:** ON → adds "For your security, do not share this code."
- **Add expiry time for the code:** ON, set to **5 minutes** (matches `OTP_TTL_SECONDS=300`).

This gives exactly **one** variable (the code). The backend already passes the
code to both the body and the copy-code button, so nothing else to wire.

---

# Customer templates (REQUIRED — these were missing)

The templates above are staff alerts. The backend ALSO sends three **customer**
templates on request received / completed / cancelled. If these aren't approved
in Meta you'll see `(#132001) Template name does not exist` and the customer
message shows **FAILED** on the dashboard (never delivered). Create all three the
same way — **Category `Utility`, Language `English` (`en`)**.

## Template 6 — `customer_request_received`

Sent to the CUSTOMER when a request is created on their behalf (e.g. a manual /
KENT-referred request) — they haven't messaged us, so it must be a template.

- **Name:** `customer_request_received` · **Category:** `Utility` · **Language:** `English` (`en`)

**Body:**
```
Hello {{1}}, we have received your water purifier service request from {{2}}.

Service request ID: {{3}}
Service Issue: {{4}}
Address: {{5}}

We will assign a technician and update you here.

If any detail is incorrect, please reply to this message.
```
Samples: {{1}} `Mohit Sharma`, {{2}} `KENT`, {{3}} `OG-140625-0001`, {{4}} `RO purifier leaking`, {{5}} `12 Shivaji Nagar, Pune 411005`

## Template 7 — `request_completed_customer`

Sent to the CUSTOMER when the request is CLOSED and the 24-hour window has lapsed.
**This is the one failing as "job completed" in the dashboard.**

- **Name:** `request_completed_customer` · **Category:** `Utility` · **Language:** `English` (`en`)

**Body:** (does not end with a variable — good)
```
Hi {{1}}, your Oasis Globe service request {{2}} has been marked completed.

Service Issue: {{3}}

Thank you for choosing Oasis Globe. If you need anything else, just reply here.
```
Samples: {{1}} `Mohit Sharma`, {{2}} `OG-140625-0001`, {{3}} `RO purifier leaking`

## Template 8 — `request_cancelled_customer`

Sent to the CUSTOMER when a request is cancelled.

- **Name:** `request_cancelled_customer` · **Category:** `Utility` · **Language:** `English` (`en`)

**Body:**
```
Hi {{1}}, your Oasis Globe service request {{2}} has been cancelled. Reason: {{3}}

If this isn't right or you'd like to raise it again, just reply here.
```
Samples: {{1}} `Mohit Sharma`, {{2}} `OG-140625-0001`, {{3}} `Customer requested cancellation`

> The delivered wording is whatever you type in Meta's Body — but the **name**,
> **language (`en`)**, and the **number of `{{n}}` variables** must match the code
> exactly (see `waTemplates.js`), or Meta rejects the send with #132000/#132001.

---

# Customer workflow templates (NEW — technician milestones)

These cover every step message the technician flow sends to the customer. They
used to go as free-form text and silently failed whenever the customer was
outside the 24-hour window (manager/KENT-referred leads, or any gap). The backend
now sends them as templates with a **free-text fallback** — so nothing breaks
before approval, and once approved they deliver every time.

Create them the same way: **Category `Utility`, Language `English` (`en`)**, name
exactly as given, paste the Body, fill the samples. **Exception:** Template 11
(`customer_arrival_otp`) is **Authentication** (Meta rejects codes under Utility).

## Template 9 — `customer_technician_assigned`

- **Name:** `customer_technician_assigned` · **Category:** `Utility` · **Language:** `en`

**Body:**
```
Technician assigned for your request {{1}}.
Name: {{2}}
Service: {{3}}

You will get an update when he starts.
```
Samples: {{1}} `OG-140725-0003`, {{2}} `Bhushan`, {{3}} `Water taste & quality deteriorated`

## Template 10 — `customer_technician_enroute`

- **Name:** `customer_technician_enroute` · **Category:** `Utility` · **Language:** `en`

**Body:**
```
Technician is on the way for your request {{1}}.
Name: {{2}}
ETA: Around {{3}} minutes.
Please keep someone available at the location.
```
Samples: {{1}} `OG-140725-0003`, {{2}} `Bhushan`, {{3}} `30`

## Template 11 — `customer_arrival_otp` (AUTHENTICATION)

Meta rejects any verification code under Utility, so this is an **Authentication**
template — same as `login_otp`. You don't type the body; Meta generates it. Just
configure:

- **Name:** `customer_arrival_otp` · **Category:** `Authentication` · **Language:** `en`
- **Code delivery:** `Copy code` button (default).
- **Add security recommendation:** **OFF** — otherwise it adds "do not share this
  code", which is the opposite of what we want (the customer shares it with the
  technician).
- **Add expiry time for the code:** ON, **60 minutes** (matches the 1-hour code
  expiry in `sendArrivalOtp`).

This gives exactly **one** variable (the code). The backend passes the code to both
the body and the copy-code button, so nothing else to wire. The customer sees
roughly: **"9265 is your verification code"** + a Copy button — they read/relay it
to the on-site technician, who enters it in the app to confirm arrival.

## Template 12 — `customer_estimate` (WITH APPROVE / REJECT BUTTONS)

- **Name:** `customer_estimate` · **Category:** `Utility` · **Language:** `en`

**Body:** (the parts list arrives as ONE comma-joined line in {{3}})
```
Estimate for your request {{1}}.
Problem: {{2}}
Charges: {{3}}
Total: {{4}}

Please tap Approve or Reject below.
```
Samples: {{1}} `OG-140725-0003`, {{2}} `Water taste & quality deteriorated`, {{3}} `Repeat Call: Free, Oasis Booster pump: ₹10, Oasis RO membranes: ₹20`, {{4}} `₹30`

**Buttons:** In the template editor, under **Buttons**, choose **Quick reply** and add
TWO buttons — this gives the customer tappable options instead of typing 1/2:

| Button type | Button text |
|-------------|-------------|
| Quick reply | `Approve` |
| Quick reply | `Reject`  |

> The button **text must be exactly `Approve` and `Reject`** — the backend reads the
> tapped label and marks the estimate approved/rejected. When the customer taps,
> Meta sends it back to the webhook as a `button` reply (already handled in
> `routes/webhook.js`). No send-time change needed; the buttons are static.
> Typing `1`/`2` or "approve"/"reject" still works as a fallback.

## Template 13 — `customer_estimate_approved`

- **Name:** `customer_estimate_approved` · **Category:** `Utility` · **Language:** `en`

**Body:**
```
Estimate approved for request {{1}}.

The technician has started the work.
```
Samples: {{1}} `OG-140725-0003`

## Template 14 — `customer_work_completed`

- **Name:** `customer_work_completed` · **Category:** `Utility` · **Language:** `en`

**Body:**
```
Work completed for your request {{1}}.

Amount due: {{2}}

Please pay now in the technician's presence.
```
Samples: {{1}} `OG-140725-0003`, {{2}} `₹30`

## Template 15 — `customer_visit_charge`

- **Name:** `customer_visit_charge` · **Category:** `Utility` · **Language:** `en`

**Body:**
```
Repair not approved for your request {{1}}.

Visit charge payable: {{2}}

Please pay the visit charge in the technician's presence.
```
Samples: {{1}} `OG-140725-0003`, {{2}} `₹250`

## Template 16 — `customer_payment_received`

- **Name:** `customer_payment_received` · **Category:** `Utility` · **Language:** `en`

**Body:**
```
Payment received for your request {{1}}.

Amount: {{2}}
Mode: {{3}}

Thank you for choosing Oasis Globe.
```
Samples: {{1}} `OG-140725-0003`, {{2}} `₹30`, {{3}} `UPI`

---

## After approval — nothing to deploy

The code already references these names. Once both show **Approved** in Meta:

- New ticket → manager gets `manager_new_request` ✅
- Assign technician → technician gets `technician_new_job` ✅

No code change or redeploy needed (unless you changed the language to `en_US`,
in which case update `WA_LANG`).

### How to test
1. From a different WhatsApp number, message the business number to raise a request.
2. Confirm the **manager** phone (`+918668732890`) receives the template alert.
3. Assign a technician from the dashboard.
4. Confirm the **technician** phone receives the job template alert.

---

## Variable rules (already handled in code)

Meta rejects body variables that contain newlines, tabs, 5+ spaces, or are empty.
`waTemplates.js` sanitises every value (collapses newlines to spaces, replaces an
empty field with `—`), so a messy address can't get a send rejected.

## Not covered here (future, if needed)

- **Manager alerts** for complaint / reschedule / handoff (`executor.js`) are
  still free-form text. Managers are usually in-window, but if those start failing
  add Utility templates the same way.
