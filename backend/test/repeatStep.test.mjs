// The "please pay" message waits for the technician to stop editing the bill.
//
// He stands in the kitchen with the bill open and corrects it — a part he
// forgot, a price he mistyped. Every save used to fire the message: Kshitij
// Gadwe (OG-140826-0009) was asked for Rs. 1,400 four times in six minutes.
// Sending only the first is no better, because a bill corrected upward leaves
// the customer holding a figure nobody is asking for.
//
// So the step only SCHEDULES; sendDuePayMessages() delivers, once, with whatever
// the bill finally says.
//
// Run: node --test --experimental-test-module-mocks test/repeatStep.test.mjs

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TICKET_ID = "t-1";
const TECH_ID = "tech-1";

let ticket, notifCalls;
const events = [];          // rows appended to ticket_events
let eventsFail = false;

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
  events.length = 0;
}

function exec(st) {
  if (st.table === "tickets") {
    // The drain's query (.not(...).lte(...)) asks for a LIST of due tickets;
    // every other read here wants the one ticket.
    if (st.poll) {
      const at = ticket.tech_work?.pay_due_at;
      return { data: at && at <= new Date().toISOString() ? [{ ...ticket }] : [], error: null };
    }
    return { data: { ...ticket }, error: null };
  }
  if (st.table === "users") return { data: [], error: null };
  if (st.table === "ticket_events") {
    if (eventsFail) return { data: null, error: { message: "invalid input value for enum" } };
    if (st.op === "insert") events.push(st.data);
    return { data: null, error: null };
  }
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
      not() { st.poll = true; return b; }, lte() { st.poll = true; return b; }, is() { return b; },
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

let runStep, sendDuePayMessages, CUSTOMER_NOTIFY;

/** Pretend the editing window has elapsed. */
const due = () => { ticket.tech_work.pay_due_at = new Date(Date.now() - 1000).toISOString(); };

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
  ({ runStep, sendDuePayMessages } = await import(url("../src/services/techJobs.js")));
  ({ CUSTOMER_NOTIFY } = await import(url("../src/config/notify.js")));
});

/* The message itself is switched OFF in config/notify.js (owner, 15 Aug 2026).
   These tests cover the MACHINERY, which is kept in place so the decision is one
   line to reverse — so they switch it on for themselves. The two tests at the
   bottom cover the off state, and set it back. */
beforeEach(() => { resetWorld(); CUSTOMER_NOTIFY.workCompleted = true; });

const toCustomer = () => notifCalls.filter((n) => n.audience === "customer");

test("finishing the work schedules the message instead of sending it", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  assert.equal(toCustomer().length, 0, "nothing goes out while he may still be editing");
  assert.ok(ticket.tech_work.pay_due_at, "it is queued");
});

test("when the editing stops, ONE message goes with the final amount", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1650 });
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1500 });

  due();                       // the wait elapses
  await sendDuePayMessages();

  assert.equal(toCustomer().length, 1, "three edits, one message");
  assert.match(toCustomer()[0].body, /1,500/, "and it carries the LAST figure, not the first");
});

test("every edit pushes the wait out again", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  // Age it by a second: two saves inside the same millisecond would otherwise
  // stamp the same time and the comparison would pass or fail on timing alone.
  const first = new Date(Date.now() - 1000).toISOString();
  ticket.tech_work.pay_due_at = first;

  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1650 });
  assert.ok(ticket.tech_work.pay_due_at > first, "the customer is not messaged mid-edit");
});

test("a technician who never stops editing is capped, not ignored", async () => {
  // Otherwise the message could be starved for as long as he keeps saving.
  ticket.tech_work.pay_first_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  assert.ok(new Date(ticket.tech_work.pay_due_at).getTime() <= Date.now() + 1000,
    "past the cap it goes on the next tick");
});

test("the drain sends it once, however often it runs", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  due();
  await sendDuePayMessages();
  await sendDuePayMessages();
  assert.equal(toCustomer().length, 1);
});

test("a correction AFTER it was sent still reaches the customer", async () => {
  /* The answer to "agar edit bill kiya wapas toh?" once the message has gone:
     it schedules again, so the customer gets the corrected figure rather than
     being left with the old one. */
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  due();
  await sendDuePayMessages();
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1650 });
  due();
  await sendDuePayMessages();

  assert.equal(toCustomer().length, 2);
  assert.match(toCustomer()[1].body, /1,650/);
});

test("moving on to the next step still applies it", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  await runStep(TECH_ID, TICKET_ID, "payment", { total: 1400, mode: "Cash" });
  assert.equal(ticket.tech_work.tech_status, "PAID", "the job moved on");
});

test("a message the owner switched off stays off, repeat or not", async () => {
  /* Payment confirmations are disabled in config/notify.js (owner's decision,
     3 Aug 2026 — customers were getting too many messages per job). Recording
     it here so a future reader does not read the silence as this guard. */
  await runStep(TECH_ID, TICKET_ID, "payment", { total: 1400, mode: "Cash" });
  await runStep(TECH_ID, TICKET_ID, "payment", { total: 1400, mode: "Cash" });
  assert.equal(toCustomer().length, 0);
});

/* With the message switched off (config/notify.js, 15 Aug 2026) nothing may be
   scheduled and nothing may be sent — including a ticket that was already
   waiting in the queue when the switch was flipped. Those must be cleared, not
   delivered late. */
test("switched off: no message is scheduled", async () => {
  CUSTOMER_NOTIFY.workCompleted = false;

  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  assert.equal(ticket.tech_work.pay_due_at, undefined, "nothing queued");
  assert.equal(toCustomer().length, 0);
});

test("switched off: a ticket already in the queue is cleared, not delivered", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  due();

  CUSTOMER_NOTIFY.workCompleted = false;      // flipped while one was in flight
  await sendDuePayMessages();

  assert.equal(toCustomer().length, 0, "the switch wins over the queue");
  assert.equal(ticket.tech_work.pay_due_at, null, "and the stamp is cleared so it stops polling");
});

/* Where the bill was written — the office's own record, never the customer's.

   The reading comes from the app with the step, taken once at that moment.
   These pin the one rule that is easy to get wrong: a later save with no fix
   must not erase the fix already on the job. */
test("the bill's location is stored with the job", async () => {
  const at = new Date().toISOString();
  await runStep(TECH_ID, TICKET_ID, "workdone", {
    total: 1400, bill_location: { lat: 18.5913, lng: 73.7389, accuracy: 12, at },
  });
  assert.deepEqual(ticket.tech_work.bill_location, { lat: 18.5913, lng: 73.7389, accuracy: 12, at });
});

test("a later save with no fix does not erase it", async () => {
  // Bill written in a basement, corrected out on the street — or the other way
  // round. Whichever came first, the office must keep the reading it got.
  await runStep(TECH_ID, TICKET_ID, "workdone", {
    total: 1400, bill_location: { lat: 18.5913, lng: 73.7389, accuracy: 12, at: new Date().toISOString() },
  });
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1650, bill_location: null });
  assert.equal(ticket.tech_work.bill_location?.lat, 18.5913, "the only location the job had survives");
  assert.equal(ticket.tech_work.total, 1650, "and the correction still lands");
});

test("a real fix arriving later does replace an empty one", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400, bill_location: null });
  await runStep(TECH_ID, TICKET_ID, "workdone", {
    total: 1400, bill_location: { lat: 18.6011, lng: 73.7500, accuracy: 8, at: new Date().toISOString() },
  });
  assert.equal(ticket.tech_work.bill_location?.lat, 18.6011);
});

test("a job billed with no location at all is still billed", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400, bill_location: null });
  assert.equal(ticket.tech_work.total, 1400);
  assert.equal(ticket.tech_work.bill_location, undefined, "nothing stored, nothing broken");
});

/* Nothing old is ever lost — the owner's rule, 20 Aug 2026.

   tech_work holds ONE bill and every save overwrites it, so a job billed at
   Rs. 2,550 and later changed to Rs. 375 kept no trace of the first figure: not
   for the office, not for a dispute, not for the commission calculated on it.
   Each change is now appended to ticket_events, which nothing rewrites. */
test("changing the bill writes a history row with both figures", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  events.length = 0;
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1650 });

  const row = events.find((e) => e.meta?.bill_changed);
  assert.ok(row, "the change is recorded");
  assert.equal(row.meta.from_total, 1400, "what it was");
  assert.equal(row.meta.to_total, 1650, "what it became");
  assert.equal(row.ticket_id, TICKET_ID);
});

test("saving the same amount writes no noise", async () => {
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  events.length = 0;
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  assert.equal(events.filter((e) => e.meta?.bill_changed).length, 0);
});

test("a rejected history row never costs the bill", async () => {
  // event_type is a constrained enum; if the insert is refused the money must
  // still be recorded. Losing the bill to protect its audit trail is backwards.
  eventsFail = true;
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1400 });
  await runStep(TECH_ID, TICKET_ID, "workdone", { total: 1650 });
  assert.equal(ticket.tech_work.total, 1650);
  eventsFail = false;
});
