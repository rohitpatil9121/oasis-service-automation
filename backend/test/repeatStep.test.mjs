// Saving a screen twice must not tell the customer twice.
//
// The app lets a technician walk back into a finished screen to correct the
// bill, and saving there re-sends the CURRENT step — the step machine only moves
// forward, so a correction is expressed as a repeat. Each repeat was firing the
// one-time customer WhatsApp again: Kshitij Gadwe (OG-140826-0009) was told
// "Work completed. Please pay Rs. 1,400" four times in six minutes.
//
// Run: node --test --experimental-test-module-mocks test/repeatStep.test.mjs

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TICKET_ID = "t-1";
const TECH_ID = "tech-1";

let ticket, notifCalls;

function resetWorld(tech_status = "DIAGNOSED") {
  ticket = {
    id: TICKET_ID,
    ticket_number: "OG-140826-0009",
    status: "IN_PROGRESS",
    issue_description: "NOT WORKING",
    assigned_technician_id: TECH_ID,
    customer: { id: "c-1", full_name: "Kshitij gadwe", phone: "+919096673367" },
    technician: { id: TECH_ID, full_name: "Chhagan Bhamre" },
    tech_work: { tech_status, total: 1400 },
  };
  notifCalls = [];
}

function exec(st) {
  if (st.table === "tickets") return { data: { ...ticket }, error: null };
  if (st.table === "users") return { data: [], error: null };
  return { data: null, error: null };
}

function makeClient() {
  const build = () => {
    const st = { table: null, op: "select", filters: [], data: null };
    const b = {
      from(t) { st.table = t; return b; },
      select() { return b; }, insert(d) { st.op = "insert"; st.data = d; return b; },
      update(d) { st.op = "update"; st.data = d; return b; },
      eq() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; },
      single: async () => exec(st), maybeSingle: async () => exec(st),
      then: (r, j) => Promise.resolve(exec(st)).then(r, j),
    };
    return b;
  };
  return {
    from: (t) => build().from(t),
    rpc: async (fn, params) => {
      if (fn === "merge_tech_work") ticket.tech_work = { ...ticket.tech_work, ...(params.p_patch || {}) };
      return { data: null, error: null };
    },
  };
}

let runStep;

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;
  mock.module(url("../src/config/supabase.js"), { namedExports: { supabase: makeClient() } });
  mock.module(url("../src/services/notifications.js"), {
    namedExports: { queueNotification: async (p) => { notifCalls.push(p); return "n-1"; } },
  });
  mock.module(url("../src/services/push.js"), { namedExports: { sendPush: async () => {} } });
  mock.module(url("../src/services/invoice.js"), { namedExports: { issueInvoiceForTicket: async () => ({}) } });
  mock.module(url("../src/services/tickets.js"), {
    namedExports: {
      updateStatus: async () => ({}), getTicket: async () => ticket,
      RATING_LABELS: {}, upsertCustomer: async () => ({ id: "c-1" }),
    },
  });
  ({ runStep } = await import(url("../src/services/techJobs.js")));
});

beforeEach(() => resetWorld());

const toCustomer = () => notifCalls.filter((n) => n.audience === "customer");

test("finishing the work tells the customer, once", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  assert.equal(toCustomer().length, 1);
  assert.match(toCustomer()[0].body, /1,400/);
});

test("re-saving the same screen does NOT tell them again", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  assert.equal(toCustomer().length, 1, "four saves, one message — this is the reported bug");
});

test("the correction is still saved, only the announcement is held back", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1650 });
  assert.equal(ticket.tech_work.total, 1650, "the bill the office sees must be the corrected one");
  assert.equal(toCustomer().length, 1);
});

test("moving on to the next step still applies it", async () => {
  // Only a REPEAT is held back. A real move forward writes as it always did.
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  await runStep(TECH_ID, TICKET_ID, "payment", { total: 1400, mode: "Cash" });
  assert.equal(ticket.tech_work.tech_status, "PAID", "the job moved on");
  assert.equal(toCustomer().length, 1, "and did not repeat the work-done message");
});

test("a message the owner switched off stays off, repeat or not", async () => {
  /* Payment confirmations are disabled in config/notify.js (owner's decision,
     3 Aug 2026 — customers were getting too many messages per job). Recording
     it here so a future reader does not read the silence as this guard. */
  await runStep(TECH_ID, TICKET_ID, "payment", { total: 1400, mode: "Cash" });
  await runStep(TECH_ID, TICKET_ID, "payment", { total: 1400, mode: "Cash" });
  assert.equal(toCustomer().length, 0);
});
