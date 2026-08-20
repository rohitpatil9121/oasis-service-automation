// A customer we already know must never be asked who they are.
//
// Rahul Wandile (+917666443831) had been on file for nine days — name, address,
// a Google Maps pin, two closed jobs — when he wrote "Leakage in water purifier"
// on 17 Aug and was answered with "Please share: – Name: – Address:".
//
// The cause was structural, not a bad reply: the model only learned who it was
// talking to by calling identify_customer, and nothing obliged it to. What we
// already know is now stated to it as fact, every turn.
//
// Run: node --test --experimental-test-module-mocks test/knownCustomer.test.mjs

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const PHONE = "+917666443831";

let customer, latestTicket;

function makeClient() {
  const build = () => {
    const st = { table: null, filters: [] };
    const b = {
      from(t) { st.table = t; return b; },
      select() { return b; }, insert() { return b; }, update() { return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      order() { return b; }, limit() { return b; }, in() { return b; }, not() { return b; },
      single: async () => run(st), maybeSingle: async () => run(st),
      then: (r, j) => Promise.resolve(run(st)).then(r, j),
    };
    return b;
  };
  const run = (st) => {
    if (st.table === "customers") return { data: customer, error: null };
    return { data: null, error: null };
  };
  return { from: (t) => build().from(t), rpc: async () => ({ data: null, error: null }) };
}

let knownCustomerNote;

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;
  mock.module(url("../src/config/supabase.js"), { namedExports: { supabase: makeClient() } });
  /* Mocking a module replaces ALL of it, so every name the agent files import
     from tickets.js has to be present here — executor.js is pulled in through
     run.js and fails to load otherwise. Only the first two are used. */
  mock.module(url("../src/services/tickets.js"), {
    namedExports: {
      getLatestTicketByCustomerPhone: async () => latestTicket,
      isOpenStatus: (s) => s && s !== "CLOSED" && s !== "CANCELLED",
      upsertCustomerByPhone: async () => ({ id: "c-1" }),
      createDraftTicket: async () => ({}),
      updateTicketIntake: async () => ({}),
      completeIntake: async () => ({}),
      getReusableTicketForCustomer: async () => null,
      getTicket: async () => ({}),
      TICKET_REUSE_DAYS: 7,
    },
  });
  ({ knownCustomerNote } = await import(url("../src/services/agent/run.js")));
});

beforeEach(() => {
  customer = { full_name: "Rahul Wandile", address: "D901, K Shire\n\nhttps://maps.app.goo.gl/E6h3" };
  latestTicket = { ticket_number: "OG-110826-0011", status: "CLOSED", intake_complete: true };

});

/** The line stated to the model as fact before the conversation starts. */
const noteFor = (phone = PHONE) => knownCustomerNote(phone).then((n) => n || "");

test("the customer's name is stated to the model, with no tool call needed", async () => {
  assert.match(await noteFor(), /Rahul Wandile/);
});

test("so is the address, and the instruction not to ask for it", async () => {
  const note = await noteFor();
  assert.match(note, /D901, K Shire/);
  assert.match(note, /Never ask for anything listed here/i);
});

test("a map link pasted as an address does not swamp the prompt", async () => {
  customer = {
    full_name: "Rahul Wandile",
    address: "D901, K Shire\n\nhttps://maps.app.goo.gl/" + "x".repeat(300),
  };
  const note = await noteFor();
  assert.ok(note.length < 400, `the note stays short (was ${note.length})`);
  assert.match(note, /D901, K Shire/, "and still carries the part a human recognises");
});

test("the last request is named, so status questions need no lookup", async () => {
  assert.match(await noteFor(), /OG-110826-0011/);
});

test("a genuinely unknown number produces nothing", async () => {
  // The opening message is the right answer for a stranger; this must not
  // interfere with that path.
  customer = null; latestTicket = null;
  assert.equal(await knownCustomerNote("+919999900000"), null);
});

test("a half-known customer still gets what we have", async () => {
  customer = { full_name: null, address: "D901, K Shire" };
  assert.match(await noteFor(), /D901, K Shire/);
});
