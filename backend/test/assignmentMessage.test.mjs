// Reassigning is office work; the customer should not have to watch it.
//
// Rahul Wandile was told "Technician assigned: Chhagan Bhamre", then "Shubham
// Jadhav", then "Chhagan Bhamre" again — for one installation. Eight jobs in a
// week had the same churn. The message now waits for the office to settle and
// names whoever the job actually ended up with.
//
// Run: node --test --experimental-test-module-mocks test/assignmentMessage.test.mjs

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

let ticket, sent;

function makeClient() {
  const build = () => {
    const st = { table: null, poll: false };
    const b = {
      from(t) { st.table = t; return b; },
      select() { return b; }, insert() { return b; }, update() { return b; },
      eq() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; },
      not() { st.poll = true; return b; }, lte() { st.poll = true; return b; }, is() { return b; },
      single: async () => run(st), maybeSingle: async () => run(st),
      then: (r, j) => Promise.resolve(run(st)).then(r, j),
    };
    return b;
  };
  const run = (st) => {
    if (st.table === "tickets" && st.poll) {
      const at = ticket.tech_work?.assign_due_at;
      return { data: at && at <= new Date().toISOString() ? [{ ...ticket }] : [], error: null };
    }
    if (st.table === "tickets") return { data: { ...ticket }, error: null };
    return { data: null, error: null };
  };
  return {
    from: (t) => build().from(t),
    rpc: async (fn, p) => {
      if (fn === "merge_tech_work") ticket.tech_work = { ...ticket.tech_work, ...(p.p_patch || {}) };
      return { data: null, error: null };
    },
  };
}

let sendDueAssignmentMessages;

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;
  mock.module(url("../src/config/supabase.js"), { namedExports: { supabase: makeClient() } });
  mock.module(url("../src/services/notifications.js"), {
    namedExports: { queueNotification: async (p) => { sent.push(p); return "n-1"; } },
  });
  mock.module(url("../src/services/push.js"), { namedExports: { sendPush: async () => {} } });
  ({ sendDueAssignmentMessages } = await import(url("../src/services/assignment.js")));
});

beforeEach(() => {
  sent = [];
  ticket = {
    id: "t-1", ticket_number: "OG-080826-0010",
    customer: { phone: "+917666443831" },
    technician: { full_name: "Chhagan Bhamre" },
    tech_work: { assign_due_at: new Date(Date.now() - 1000).toISOString() },
  };
});

test("one message goes, naming whoever the job ended up with", async () => {
  ticket.technician = { full_name: "Shubham Jadhav" };   // the office settled here
  await sendDueAssignmentMessages();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Shubham Jadhav/, "the last name, not the first");
});

test("the drain cannot send the same one twice", async () => {
  await sendDueAssignmentMessages();
  await sendDueAssignmentMessages();
  assert.equal(sent.length, 1);
});

test("a shuffle that ends where it started says nothing at all", async () => {
  // Chhagan → Shubham → Chhagan. The customer already knows Chhagan is coming.
  ticket.tech_work.assign_told = "Chhagan Bhamre";
  await sendDueAssignmentMessages();
  assert.equal(sent.length, 0, "nothing changed for the customer");
});

test("a genuine reassignment later does reach them", async () => {
  ticket.tech_work.assign_told = "Chhagan Bhamre";
  ticket.technician = { full_name: "Bhujang Sangle" };
  await sendDueAssignmentMessages();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Bhujang Sangle/);
});

test("a job with nobody on it yet is left alone", async () => {
  ticket.technician = null;
  await sendDueAssignmentMessages();
  assert.equal(sent.length, 0);
});
