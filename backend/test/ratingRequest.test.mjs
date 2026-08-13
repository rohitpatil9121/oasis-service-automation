// The rating ask is delivered by a poll, not at close time, so its bookkeeping
// lives in tech_work: rating_due_at says "ask when this passes", rating_sent_at
// says "already asked". A job closed twice re-stamps due_at on a ticket that was
// asked days ago — and the guard that skips it used to leave due_at standing, so
// the ticket came back in the poll's query on every tick, for ever. Eight of them
// were sitting in the live database.
//
// Run: node --test --experimental-test-module-mocks test/ratingRequest.test.mjs

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const PHONE = "+919999999999";

let tickets;        // rows the poll's query would return
let notifCalls;
let inboundAt;      // when the customer last messaged us, or null

function resetWorld() {
  tickets = [];
  notifCalls = [];
  inboundAt = new Date().toISOString();   // inside the 24h window by default
}

const addTicket = (id, tech_work) =>
  tickets.push({ id, ticket_number: `OG-${id}`, tech_work, customer: { phone: PHONE } });

function exec(st) {
  if (st.table === "tickets") {
    // A lookup by id (the button-tap path) wants that one row; the poll's query
    // filters on status + rating_due_at, and the fixture only holds rows that
    // already match, so hand those back whole.
    const byId = st.filters.find(([col]) => col === "id");
    if (byId) {
      const hit = tickets.find((t) => t.id === byId[1]);
      return { data: hit ? { ...hit } : null, error: null };
    }
    return { data: tickets.map((t) => ({ ...t })), error: null };
  }
  if (st.table === "wa_inbound") {
    return { data: inboundAt ? { created_at: inboundAt } : null, error: null };
  }
  return { data: null, error: null };
}

function makeClient() {
  const build = () => {
    const st = { table: null, filters: [] };
    const b = {
      from(tbl) { st.table = tbl; return b; },
      select() { return b; },
      update() { return b; },
      insert() { return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      not() { return b; },
      is() { return b; },
      lte() { return b; },
      gte() { return b; },
      order() { return b; },
      limit() { return b; },
      single: async () => exec(st),
      maybeSingle: async () => exec(st),
      then: (res, rej) => Promise.resolve(exec(st)).then(res, rej),
    };
    return b;
  };
  return {
    from: (tbl) => build().from(tbl),
    rpc: async (fn, params) => {
      if (fn !== "merge_tech_work") return { data: null, error: null };
      const t = tickets.find((x) => x.id === params.p_ticket_id);
      if (t) t.tech_work = { ...(t.tech_work || {}), ...(params.p_patch || {}) };
      return { data: null, error: null };
    },
  };
}

let sendDueRatingRequests, sendRatingListForPayload;

// env is read at call time, so a test can turn the button template on and off.
const envStub = { ratingButtonTemplate: "", defaultCountryCode: "+91" };

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;
  mock.module(url("../src/config/env.js"), { namedExports: { env: envStub, checkEnv: () => {} } });
  mock.module(url("../src/config/supabase.js"), { namedExports: { supabase: makeClient() } });
  mock.module(url("../src/services/notifications.js"), {
    namedExports: { queueNotification: async (p) => { notifCalls.push(p); return "n-1"; } },
  });
  ({ sendDueRatingRequests, sendRatingListForPayload } = await import(url("../src/services/tickets.js")));
});

beforeEach(() => { resetWorld(); envStub.ratingButtonTemplate = ""; });

const work = (id) => tickets.find((t) => t.id === id).tech_work;

test("a due job is asked once, and the ask carries the five star rows", async () => {
  addTicket("t1", { rating_due_at: "2026-08-01T00:00:00.000Z" });
  await sendDueRatingRequests();

  assert.equal(notifCalls.length, 1);
  const rows = notifCalls[0].interactive?.action?.sections?.[0]?.rows || [];
  assert.equal(rows.length, 5, "five options, ★ to ★★★★★");
  assert.deepEqual(rows.map((r) => r.title), ["★★★★★", "★★★★", "★★★", "★★", "★"]);
  assert.equal(work("t1").rating_due_at, null, "and it stops being due");
  assert.ok(work("t1").rating_sent_at);
});

test("a job closed a second time is not asked again", async () => {
  addTicket("t2", { rating_due_at: "2026-08-11T13:01:00.000Z", rating_sent_at: "2026-08-09T14:15:00.000Z" });
  await sendDueRatingRequests();

  assert.equal(notifCalls.length, 0, "the customer already had their one ask");
});

test("...and it stops coming back to the poll for ever", async () => {
  addTicket("t2", { rating_due_at: "2026-08-11T13:01:00.000Z", rating_sent_at: "2026-08-09T14:15:00.000Z" });
  await sendDueRatingRequests();

  assert.equal(work("t2").rating_due_at, null,
    "left standing, this ticket is selected by every poll from now until someone notices");
  assert.equal(work("t2").rating_sent_at, "2026-08-09T14:15:00.000Z", "the original ask time is preserved");
});

test("with a button template approved, the out-of-window ask carries a tappable way in", async () => {
  envStub.ratingButtonTemplate = "rating_request_button";
  inboundAt = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
  addTicket("t7", { rating_due_at: "2026-08-01T00:00:00.000Z" });
  await sendDueRatingRequests();

  assert.equal(notifCalls.length, 1);
  const tpl = notifCalls[0].template;
  assert.equal(tpl?.name, "rating_request_button");
  assert.deepEqual(tpl?.quickReplyPayloads, ["rate_open_t7"],
    "the payload is what identifies the ticket when the tap comes back");
});

test("tapping that button sends the real five-star list", async () => {
  // The tap opened the 24-hour window, so the interactive message is allowed.
  addTicket("t8", {});
  const sent = await sendRatingListForPayload("rate_open_t8");

  assert.equal(sent, true);
  const rows = notifCalls[0]?.interactive?.action?.sections?.[0]?.rows || [];
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.id), ["rate_t8_5", "rate_t8_4", "rate_t8_3", "rate_t8_2", "rate_t8_1"]);
});

test("a payload that isn't ours is left for intake", async () => {
  assert.equal(await sendRatingListForPayload("approve_estimate_9"), false);
  assert.equal(notifCalls.length, 0, "and nothing is sent");
});

test("outside WhatsApp's 24-hour window the ask falls back to the approved template", async () => {
  // Meta refuses interactive messages there, so the customer gets the plain
  // completion template instead — no stars are possible, by Meta's rule.
  inboundAt = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
  addTicket("t3", { rating_due_at: "2026-08-01T00:00:00.000Z" });
  await sendDueRatingRequests();

  assert.equal(notifCalls.length, 1);
  assert.equal(notifCalls[0].interactive, undefined);
  assert.ok(notifCalls[0].template, "a template is the only thing deliverable out there");
});

test("a customer who never messaged us gets the template too", async () => {
  inboundAt = null;
  addTicket("t4", { rating_due_at: "2026-08-01T00:00:00.000Z" });
  await sendDueRatingRequests();

  assert.equal(notifCalls.length, 1);
  assert.equal(notifCalls[0].interactive, undefined);
});

test("the ticket is claimed before the send, so the next poll skips it", async () => {
  addTicket("t5", { rating_due_at: "2026-08-01T00:00:00.000Z" });
  await sendDueRatingRequests();
  await sendDueRatingRequests();   // 60 seconds later

  assert.equal(notifCalls.length, 1, "the customer is asked once, not once a minute");
});

test("two pollers running at the same instant DO both ask — known limitation", async () => {
  // Documenting what the code actually guarantees, not what we wish it did.
  // The claim is a read-then-write, so both runs read rating_sent_at as null
  // before either writes it. Today one instance polls once a minute and a run
  // finishes in well under that, so the overlap does not arise; a second web
  // instance, or a run that takes longer than the interval, would double-ask.
  // Closing it properly needs a conditional claim in SQL (like merge_tech_work
  // in db/phase7_atomic_tech_work.sql), not another guard in JS.
  addTicket("t6", { rating_due_at: "2026-08-01T00:00:00.000Z" });
  await Promise.all([sendDueRatingRequests(), sendDueRatingRequests()]);

  assert.equal(notifCalls.length, 2);
});
