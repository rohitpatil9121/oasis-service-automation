// Regression test for the duplicate "failed" completion message.
//
// A ticket can be closed from two places (manager dashboard + technician app),
// and closes can be retried or double-tapped. updateStatus() must fire the
// one-time customer completion WhatsApp EXACTLY ONCE per real transition —
// otherwise the customer is notified once while the portal shows a second,
// "failed" duplicate row (the reported OG-030726-0001 incident).
//
// Run: node --test test/updateStatus.test.mjs   (from backend/)

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TICKET_ID = "t-1";

// ---- In-memory store the fake Supabase reads/writes ----
let store;
let notifCalls;

function resetWorld(status = "IN_PROGRESS") {
  store = {
    tickets: {
      [TICKET_ID]: {
        id: TICKET_ID,
        status,
        ticket_number: "OG-030726-0001",
        issue_description: "NOT WORKING",
        customer: { id: "c-1", full_name: "AKASH", phone: "+919999999999" },
        technician: null,
      },
    },
  };
  notifCalls = [];
}

// Minimal chainable Supabase stub. Terminal methods (single/maybeSingle) and
// `await`-ing the builder directly (used by insert) both execute against `store`.
function exec(st) {
  const t = store.tickets[TICKET_ID];
  if (st.table === "tickets" && st.op === "select") {
    return { data: t ? { ...t } : null, error: t ? null : { message: "not found" } };
  }
  if (st.table === "tickets" && st.op === "update") {
    // Every eq() filter must match the CURRENT stored row (this is what makes
    // the conditional `.eq("status", current.status)` race-guard meaningful).
    const matches = st.filters.every(([col, val]) => t[col] === val);
    if (!matches) return { data: null, error: null }; // lost the race / stale read
    Object.assign(t, st.data);
    return { data: { ...t }, error: null };
  }
  if (st.table === "wa_inbound") {
    // Pretend the customer messaged us seconds ago → within the 24h window, so
    // updateStatus takes the interactive-list branch (one queueNotification).
    return { data: { created_at: new Date().toISOString() }, error: null };
  }
  return { data: null, error: null }; // ticket_events insert, etc.
}

function makeClient() {
  const build = () => {
    const st = { table: null, op: "select", filters: [], data: null };
    const b = {
      from(tbl) { st.table = tbl; return b; },
      select() { return b; },
      update(d) { st.op = "update"; st.data = d; return b; },
      insert(d) { st.op = "insert"; st.data = d; return b; },
      eq(col, val) { st.filters.push([col, val]); return b; },
      order() { return b; },
      limit() { return b; },
      single: async () => exec(st),
      maybeSingle: async () => exec(st),
      // Make the builder itself awaitable (logEvent does `await ...insert(...)`).
      then: (res, rej) => Promise.resolve(exec(st)).then(res, rej),
    };
    return b;
  };
  return {
    from: (tbl) => build().from(tbl),
    // mergeTechWork() goes through the atomic merge_tech_work RPC
    // (db/phase7_atomic_tech_work.sql), not from()/update(). Mirror its one
    // semantic that matters here: a patch shallow-merges into tech_work and an
    // omitted key is left alone rather than deleted.
    rpc: async (fn, params) => {
      if (fn !== "merge_tech_work") return { data: null, error: null };
      const t = store.tickets[params.p_ticket_id];
      if (!t) return { data: null, error: { message: "ticket not found" } };
      t.tech_work = { ...(t.tech_work || {}), ...(params.p_patch || {}) };
      return { data: null, error: null };
    },
  };
}

// ---- Wire the mocks in place of the real modules, then import the SUT ----
let updateStatus;

before(async () => {
  const supaUrl = new URL("../src/config/supabase.js", import.meta.url).href;
  const notifUrl = new URL("../src/services/notifications.js", import.meta.url).href;

  mock.module(supaUrl, {
    namedExports: { supabase: makeClient() },
  });
  mock.module(notifUrl, {
    namedExports: {
      queueNotification: async (payload) => { notifCalls.push(payload); return "notif-id"; },
    },
  });

  ({ updateStatus } = await import(new URL("../src/services/tickets.js", import.meta.url).href));
});

beforeEach(() => resetWorld());

const customerNotifs = () => notifCalls.filter((n) => n.audience === "customer");

/* What "sends the completion message once" means today.

   Closing no longer messages the customer inline. The technician is usually
   still standing in the kitchen when the job is closed, so asking "how was our
   service?" that instant was wrong. updateStatus stamps rating_due_at instead,
   and sendDueRatingRequests — polled by the server — delivers the combined
   "your request is complete / rate us" message once the delay has elapsed.

   So the one-per-transition invariant now lives on that stamp: a real close
   sets it, a repeated or losing close must not set it again with a later time,
   which would silently push the customer's message further away each retry. */
const dueAt = () => store.tickets[TICKET_ID].tech_work?.rating_due_at;

test("closing an IN_PROGRESS ticket stamps the rating exactly once", async () => {
  await updateStatus(TICKET_ID, "CLOSED", "actor-1");
  assert.equal(store.tickets[TICKET_ID].status, "CLOSED");
  assert.ok(dueAt(), "rating_due_at must be stamped");
  assert.equal(customerNotifs().length, 0, "nothing goes out while the tech is still on site");
});

test("closing an already-CLOSED ticket changes nothing (no phantom dup)", async () => {
  await updateStatus(TICKET_ID, "CLOSED", "actor-1");
  const first = dueAt();
  await updateStatus(TICKET_ID, "CLOSED", "actor-2"); // no-op
  assert.equal(dueAt(), first, "a repeated close must not push the rating later");
  assert.equal(customerNotifs().length, 0);
});

test("concurrent closes (dashboard + tech app racing) stamp exactly one", async () => {
  await Promise.all([
    updateStatus(TICKET_ID, "CLOSED", "manager"),
    updateStatus(TICKET_ID, "CLOSED", "technician"),
  ]);
  assert.equal(store.tickets[TICKET_ID].status, "CLOSED");
  assert.ok(dueAt());
  assert.equal(customerNotifs().length, 0);
});

test("a no-op transition returns the ticket without touching the DB", async () => {
  resetWorld("NEW");
  const result = await updateStatus(TICKET_ID, "NEW", "actor-1");
  assert.equal(result.status, "NEW");
  assert.equal(customerNotifs().length, 0);
});
