// Everything the office is told about a customer must be able to arrive.
//
// Plain WhatsApp text only reaches a phone that has messaged the business in the
// last 24 hours. Staff almost never do, so these alerts died with "131047
// Re-engagement message" — silently, because a failure is a row nobody reads.
//
// It cost a real customer twice: Rahul Wandile (+917666443831) asked for a
// callback on 8 Aug and for an 8 pm slot on 12 Aug. Neither alert reached the
// manager or the owner, and the bot had already told him the team would confirm.
//
// Run: node --test --experimental-test-module-mocks test/officeAlerts.test.mjs

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

let sent, customer, ticket;

function makeClient() {
  const build = () => {
    const st = { table: null, filters: [] };
    const b = {
      from(t) { st.table = t; return b; },
      select() { return b; }, insert() { return b; }, update() { return b; },
      eq() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; },
      not() { return b; }, is() { return b; }, lte() { return b; }, gte() { return b; },
      single: async () => run(st), maybeSingle: async () => run(st),
      then: (r, j) => Promise.resolve(run(st)).then(r, j),
    };
    return b;
  };
  const run = (st) => {
    if (st.table === "customers") return { data: customer, error: null };
    if (st.table === "users") return { data: [{ phone: "+919000000001" }], error: null };
    if (st.table === "tickets") return { data: ticket, error: null };
    return { data: null, error: null };
  };
  return { from: (t) => build().from(t), rpc: async () => ({ data: null, error: null }) };
}

let executeTool;

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;
  mock.module(url("../src/config/supabase.js"), { namedExports: { supabase: makeClient() } });
  mock.module(url("../src/services/notifications.js"), {
    namedExports: { queueNotification: async (p) => { sent.push(p); return "n-1"; } },
  });
  mock.module(url("../src/services/tickets.js"), {
    namedExports: {
      upsertCustomerByPhone: async () => ({ id: "c-1" }),
      createDraftTicket: async () => ({}), updateTicketIntake: async () => ({}),
      completeIntake: async () => ({}), getReusableTicketForCustomer: async () => null,
      getLatestTicketByCustomerPhone: async () => ticket, getTicket: async () => ticket,
    },
  });
  ({ executeTool } = await import(url("../src/services/agent/executor.js")));
});

beforeEach(() => {
  sent = [];
  customer = { full_name: "Rahul Wandile", address: "D901, K Shire" };
  ticket = { id: "t-1", ticket_number: "OG-110826-0011", status: "ASSIGNED" };
});

const toOffice = () => sent.filter((n) => n.audience === "manager");

test("a reschedule request rides an approved template", async () => {
  await executeTool("request_reschedule", { preferred_time: "8 pm" }, { phone: "+917666443831" });
  assert.ok(toOffice().length, "somebody is told");
  assert.ok(toOffice()[0].template, "with a template, so a closed 24-hour window cannot swallow it");
  assert.match(toOffice()[0].body, /RESCHEDULE/);
});

test("the customer's own words travel in the template", async () => {
  await executeTool("request_reschedule", { preferred_time: "8 pm" }, { phone: "+917666443831" });
  const vars = toOffice()[0].template.variables.map((v) => v.text ?? v);
  assert.ok(vars.some((v) => /8 pm/.test(String(v))), "the preferred time must survive the trip");
  assert.ok(vars.some((v) => /Rahul Wandile/.test(String(v))), "and who is asking");
});

test("a handoff request is templated too", async () => {
  await executeTool("escalate_to_human", { reason: "wants a callback" },
    { phone: "+917666443831", ticketId: "t-1", ticketNumber: "OG-110826-0011" });
  assert.ok(toOffice().length);
  assert.ok(toOffice()[0].template);
  assert.match(toOffice()[0].body, /Handoff requested/);
});

test("a handoff with no ticket still goes, as plain text", async () => {
  // The template's first variable is a request number; with no request there is
  // nothing truthful to put there, so it falls back rather than inventing one.
  await executeTool("escalate_to_human", { reason: "no request yet" }, { phone: "+919999900000" });
  assert.ok(toOffice().length, "the office is still told");
  assert.equal(toOffice()[0].template, undefined);
});
