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
Issue: {{5}}

Please contact the customer and proceed with the visit.
```

**Sample values (for approval):**
| Variable | Meaning | Sample |
|----------|---------|--------|
| {{1}} | Ticket number | `OG-140625-0001` |
| {{2}} | Customer name | `Mohit Sharma` |
| {{3}} | Customer phone | `+919812345678` |
| {{4}} | Address | `12 Shivaji Nagar, Pune 411005` |
| {{5}} | Issue | `AC not cooling` |

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

- **Customer "technician assigned"** alert: usually sent soon after the customer
  messaged (so it's inside the window). If you ever assign days later, add a
  `customer_technician_assigned` template the same way and wire it in
  `assignment.js`'s customer notification.
- **OTP login** message to staff: also free-form today; if staff can't receive
  login codes, an `auth_otp` Utility/Authentication template would be the fix.
