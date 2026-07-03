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
  return { from: (tbl) => build().from(tbl) };
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

test("closing an IN_PROGRESS ticket sends the completion message once", async () => {
  await updateStatus(TICKET_ID, "CLOSED", "actor-1");
  assert.equal(store.tickets[TICKET_ID].status, "CLOSED");
  assert.equal(customerNotifs().length, 1);
});

test("closing an already-CLOSED ticket sends nothing (no phantom 'failed' dup)", async () => {
  await updateStatus(TICKET_ID, "CLOSED", "actor-1"); // real transition → 1
  await updateStatus(TICKET_ID, "CLOSED", "actor-2"); // no-op → 0
  assert.equal(customerNotifs().length, 1);
});

test("concurrent closes (dashboard + tech app racing) send exactly one", async () => {
  await Promise.all([
    updateStatus(TICKET_ID, "CLOSED", "manager"),
    updateStatus(TICKET_ID, "CLOSED", "technician"),
  ]);
  assert.equal(store.tickets[TICKET_ID].status, "CLOSED");
  assert.equal(customerNotifs().length, 1);
});

test("a no-op transition returns the ticket without touching the DB", async () => {
  resetWorld("NEW");
  const result = await updateStatus(TICKET_ID, "NEW", "actor-1");
  assert.equal(result.status, "NEW");
  assert.equal(customerNotifs().length, 0);
});
