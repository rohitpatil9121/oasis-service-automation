// The last line of defence against a customer reading the same message twice.
//
// Kshitij Gadwe (OG-140826-0009) was sent "Work completed. Please pay Rs. 1,400"
// four times in six minutes, at 11:35, 11:38, 11:40 and 11:41 pm. The cause was
// found and fixed upstream (a technician re-saving the bill re-fired the step),
// but every future path also ends here, so the check ends here too.
//
// Run: node --test --experimental-test-module-mocks test/duplicateGuard.test.mjs

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const WORK_DONE = "Work completed.\nPlease pay ₹1,400 to the technician now.";
const CUSTOMER = "+919096673367";

let sentRows, wa;

function makeClient() {
  const build = () => {
    const st = { table: null, op: "select", filters: [], gte: null };
    const b = {
      from(t) { st.table = t; return b; },
      select() { return b; },
      insert(d) { st.op = "insert"; st.data = d; return b; },
      update() { return b; },
      eq(col, val) { st.filters.push([col, val]); return b; },
      gte(col, val) { st.gte = val; return b; },
      order() { return b; }, limit() { return b; },
      single: async () => run(st), maybeSingle: async () => run(st),
      then: (r, j) => Promise.resolve(run(st)).then(r, j),
    };
    return b;
  };
  const run = (st) => {
    if (st.table !== "notifications") return { data: null, error: null };
    if (st.op === "insert") {
      // The column has a database default, so a real insert always lands with a
      // timestamp even though the service never sends one.
      const row = { created_at: new Date().toISOString(), ...st.data };
      sentRows.push(row);
      return { data: row, error: null };
    }
    const want = Object.fromEntries(st.filters);
    const found = sentRows.filter((r) =>
      r.recipient === want.recipient && r.body === want.body && r.status === want.status &&
      (!st.gte || r.created_at >= st.gte));
    return { data: found, error: null };
  };
  return { from: (t) => build().from(t) };
}

let queueNotification;

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;
  mock.module(url("../src/config/supabase.js"), { namedExports: { supabase: makeClient() } });
  mock.module(url("../src/services/whatsapp.js"), {
    namedExports: {
      sendWhatsApp: async (to, body) => { wa.push({ to, body }); return { sid: "s1" }; },
      sendWhatsAppTemplate: async (to, t, body) => { wa.push({ to, body }); return { sid: "s2" }; },
      sendWhatsAppInteractive: async (to, i, body) => { wa.push({ to, body }); return { sid: "s3" }; },
      sendWhatsAppDocument: async (to, d, body) => { wa.push({ to, body }); return { sid: "s4" }; },
    },
  });
  ({ queueNotification } = await import(url("../src/services/notifications.js")));
});

beforeEach(() => { sentRows = []; wa = []; });

const send = (body, audience = "customer", recipient = CUSTOMER) =>
  queueNotification({ recipient, body, audience });

test("the same message twice in a row reaches the customer once", async () => {
  await send(WORK_DONE);
  await send(WORK_DONE);
  await send(WORK_DONE);
  await send(WORK_DONE);
  assert.equal(wa.length, 1, "four attempts, one WhatsApp — the reported incident");
});

test("a different message still goes", async () => {
  await send(WORK_DONE);
  await send("Payment of ₹1,400 received via Cash.");
  assert.equal(wa.length, 2);
});

test("a corrected amount is a different message, so it is sent", async () => {
  // Suppressing this would hide a correction the customer needs.
  await send(WORK_DONE);
  await send("Work completed.\nPlease pay ₹1,650 to the technician now.");
  assert.equal(wa.length, 2);
});

test("the same words to a different customer are not suppressed", async () => {
  await send(WORK_DONE);
  await send(WORK_DONE, "customer", "+919999999999");
  assert.equal(wa.length, 2);
});

test("staff alerts are left alone", async () => {
  /* The office genuinely can be told the same thing twice — two managers, or a
     repeated escalation on a job nobody has picked up. Only the customer's side
     is guarded. */
  await send("COMPLAINT from +918390857152: water is leaking", "manager");
  await send("COMPLAINT from +918390857152: water is leaking", "manager");
  assert.equal(wa.length, 2);
});

test("a failed send does not block the retry", async () => {
  // Only a message that actually went out counts as already said.
  sentRows.push({ recipient: CUSTOMER, body: WORK_DONE, status: "FAILED", created_at: new Date().toISOString() });
  await send(WORK_DONE);
  assert.equal(wa.length, 1);
});

test("the same message tomorrow is a new message", async () => {
  sentRows.push({
    recipient: CUSTOMER, body: WORK_DONE, status: "SENT",
    created_at: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
  });
  await send(WORK_DONE);
  assert.equal(wa.length, 1, "the window is minutes, not for ever");
});
