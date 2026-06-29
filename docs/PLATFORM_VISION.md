# Oasis Globe — Platform Vision (all roles)

> Direction from the owner (Bhushan): build something **Urban-Company-like in
> polish and trust**, but for a **small-scale service centre** — our technicians
> are **employees dispatched by a service manager**, *not* independent/marketplace
> technicians. Keep it **as simple as possible** while it **builds trust in the
> customer's mind**. Every role's experience must be good:
>
> - **Customer** — simple, trusted, kept informed.
> - **Technician & Service Manager** — smooth, low-friction work.
> - **Owner** — clear view of **profitability, customer satisfaction, and work done**.

This document frames the whole platform across four roles. The technician app
build detail lives in [`../technician-app/SPEC.md`](../technician-app/SPEC.md);
this is the higher-level vision that spec serves.

---

## 1. The model: a service centre (not a marketplace)

- Jobs come in (WhatsApp / phone / KENT referral) and become **tickets**.
- A **Service Manager** centrally **assigns** each ticket to one of *our*
  technicians and sets the visit slot. Technicians do **not** browse/bid for
  jobs — they execute what's assigned.
- The **technician** runs the on-site job through a fixed, trust-building flow.
- The **owner** watches the business: money in vs parts cost, ratings, and
  throughput.

The four surfaces share **one backend, one database, one customer history** —
nothing is forked.

---

## 2. Customer experience (the trust layer)

Goal: the customer always knows **who** is coming, **when**, **what it costs**,
and **never gets a surprise charge**. Urban-Company-style signals, minimal
messages.

### 2.1 What the customer receives on WhatsApp (milestone by milestone)

One clean message per milestone — never spam, never duplicated (owner rule).

| When | Message to customer (sample copy) |
|---|---|
| **Request received** | "Hi {name}, we've received your service request for your {model}. Request ID: {id}. We're assigning a technician — you'll get an update shortly." |
| **Technician assigned** | "{tech_name} (⭐{rating}) is assigned for your {model} service today. Expected visit: {slot}. You can reach them on {phone}." *(name + rating = trust)* |
| **On the way** | "{tech_name} is on the way. Expected arrival: {eta}." |
| **Arrived** | "{tech_name} has reached your location." |
| **Estimate (paid work)** | "After checking your {model}: {charge} + parts {parts} = **Total ₹{amount}**. Reply **YES** to approve or **NO** to decline. Work starts only after your approval." |
| **Estimate (free)** | "Good news — this visit is covered under {warranty/AMC / 10-day repeat}. **No charge.**" |
| **Payment** | "Service complete. Amount: ₹{amount}. Pay by UPI {link/QR} or to the technician directly." |
| **Done + feedback** | "Your {model} service is complete. How was your experience? [Excellent] [Okay] [Poor]" |
| **Next-service reminder** *(later)* | "Reminder: your {model} is due for service in {interval}. Reply to book." |

### 2.2 Trust signals (what makes it feel safe)
- **Technician identity up front** — name + rating (photo later) before arrival.
- **Live status + ETA**, like a delivery you can track.
- **Approval before any paid work** — no surprise bills.
- **Warranty / AMC / repeat-call** clearly shown as **free** when applicable.
- **Digital payment + instant confirmation/receipt.**
- **Feedback request** every time → the customer feels heard.
- *(Optional, strong trust)* **Start-OTP:** customer reads a code to the
  technician to start the job — proves the right person from the right centre.

---

## 3. Technician experience

Covered in detail in `technician-app/SPEC.md`. In short: phone app, today's
assigned jobs, and a fixed job flow (Accept → On the way → Arrived → Diagnose →
Estimate → Approval → **Work Done** → Payment → Close), each step auto-sending the
customer message above and logging proof — GPS, before/damage photos, TDS, and at
**Work Done** the **final output TDS + photos of new parts installed and old/used
parts removed** before any payment. Plus their ratings and a help/script section.
**Smooth, no-thinking, hard-to-make-mistakes.**

---

## 4. Service Manager experience (the dispatch & control layer)

The manager is the hub. They work from the **dashboard** (the existing website).
What they need:

- **Live dispatch board** — every ticket by status (New · Assigned · On the way ·
  Arrived · In progress · Awaiting approval · Paid · Closed), refreshing live.
- **Assign / reassign** a technician and **set the visit slot**.
- **Technician availability** — who is Online/Offline, who is free.
- **Approve estimates** on the customer's behalf when the customer can't respond
  (the technician's approval step can route here).
- **Escalations & repeat calls** — surfaced for action (urgent, repeat-within-10-days).
- **Lead follow-up** — leads the technician raises at close ("customer wants a new
  purifier / special part").
- **Customer history** — past tickets, ratings, warranty/AMC status at a glance.

> Goal for the manager: see everything, assign fast, unblock the technician,
> keep customers moving — without chasing anyone.

---

## 5. Owner experience (the business view)

A simple owner dashboard answering three questions, no clutter:

- **Profitability** — revenue collected, parts cost, **net margin**; by day / week
  / technician / area. Paid vs free-visit split.
- **Customer satisfaction** — average rating / CSAT trend, **low ratings flagged**,
  first-time-fix rate, repeat-complaint rate.
- **Work done** — jobs completed vs pending, today/this week, per technician
  throughput, average time-to-close.
- **Pipeline** — open leads / upsell opportunities.

> Goal for the owner: open the app and instantly see *are we making money, are
> customers happy, is the work getting done.*

---

## 6. Guiding principles

1. **Simple over clever.** Fewest taps; the system does the remembering.
2. **Trust by default.** Identity, status, approval-before-charge, receipts,
   feedback — every time.
3. **One system, one truth.** Customer ↔ technician ↔ manager ↔ owner all see the
   same ticket. No re-entry, no forks.
4. **Minimal messaging.** Exactly one customer message per milestone.
5. **Service-centre, not marketplace.** Central assignment by the manager;
   technicians execute.

---

## 7. How this maps to build

- **Customer surface** = WhatsApp (existing intake + the milestone messages in
  §2.1). Mostly message templates + the right triggers.
- **Technician surface** = the new app (`technician-app/SPEC.md`).
- **Service Manager surface** = extend the existing dashboard (dispatch board,
  approvals, escalations).
- **Owner surface** = an owner view/dashboard (profitability + CSAT + work done).

Build order suggestion: technician app + customer messages first (the visible,
trust-building loop), then manager dispatch/approval, then owner analytics.
