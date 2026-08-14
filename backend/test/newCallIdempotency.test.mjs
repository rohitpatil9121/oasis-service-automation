// The technician app parks a "New Call" in its offline outbox and replays it
// when the signal comes back. A replay is not only the offline case: a request
// that REACHED us and lost its response on the way back lands in the same code
// path, and on one bar of signal that is routine. The outbox, having seen no
// answer, sends it again under the same client_id.
//
// createMyCall must answer that repeat with the ticket it already made. Getting
// this wrong is not a cosmetic duplicate — it is a second row in the office
// queue, a second manager alert, and a second "we've received your request"
// WhatsApp to a customer who asked once.
//
// Run: node --test test/newCallIdempotency.test.mjs   (from backend/)

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TECH_ID = "tech-1";
const CALL = { name: "Akash", phone: "+919999999999", area: "Kothrud", problem: "NOT WORKING" };

let store;          // { tickets: [...], customers: [...] }
let columnMissing;  // true = db/phase8 migration not applied yet
let notifCalls;
let seq;

function resetWorld() {
  store = { tickets: [], customers: [] };
  notifCalls = [];
  columnMissing = false;
  seq = 0;
}

/* Minimal Supabase stub over `store`. Only the shapes createMyCall actually
   uses: select().eq().maybeSingle(), insert().select().single(), and the
   manager fan-out's select().eq().eq(). */
function exec(st) {
  if (st.op === "insert") {
    if (st.table === "customers") {
      const row = { id: `c-${++seq}`, ...st.data };
      store.customers.push(row);
      return { data: row, error: null };
    }
    if (st.table === "tickets") {
      // Postgres refuses a column it does not have: error 42703.
      if (columnMissing && "client_id" in st.data) {
        return { data: null, error: { code: "42703", message: "column \"client_id\" of relation \"tickets\" does not exist" } };
      }
      // The unique index from db/phase8_tech_call_idempotency.sql. Postgres
      // reports a violation as 23505; the service turns that into "here is the
      // ticket you already made" rather than an error.
      if (st.data.client_id && store.tickets.some((t) => t.client_id === st.data.client_id)) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      const row = {
        id: `t-${++seq}`,
        ticket_number: `OG-100${seq}`,
        ...st.data,
        customer: store.customers.find((c) => c.id === st.data.customer_id) || null,
        technician: { id: TECH_ID, full_name: "Rohit" },
      };
      store.tickets.push(row);
      return { data: { ...row }, error: null };
    }
    return { data: null, error: null };
  }

  if (st.table === "tickets") {
    const found = store.tickets.filter((t) =>
      st.filters.every(([col, val]) => t[col] === val));
    return { data: found[0] ? { ...found[0] } : null, error: null };
  }
  if (st.table === "users") return { data: [{ phone: "+918888888888" }], error: null };  // one manager
  return { data: null, error: null };
}

function makeClient() {
  const build = () => {
    const st = { table: null, op: "select", filters: [], data: null };
    const b = {
      from(tbl) { st.table = tbl; return b; },
      select() { return b; },
      insert(d) { st.op = "insert"; st.data = d; return b; },
      update(d) { st.op = "update"; st.data = d; return b; },
      eq(col, val) { st.filters.push([col, val]); return b; },
      order() { return b; },
      limit() { return b; },
      single: async () => exec(st),
      maybeSingle: async () => exec(st),
      then: (res, rej) => Promise.resolve(exec(st)).then(res, rej),
    };
    return b;
  };
  return { from: (tbl) => build().from(tbl), rpc: async () => ({ data: null, error: null }) };
}

let createMyCall;

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;

  mock.module(url("../src/config/supabase.js"), { namedExports: { supabase: makeClient() } });
  mock.module(url("../src/services/notifications.js"), {
    namedExports: { queueNotification: async (p) => { notifCalls.push(p); return "n-1"; } },
  });
  mock.module(url("../src/services/tickets.js"), {
    namedExports: {
      upsertCustomer: async ({ full_name, phone, address }) => {
        const hit = store.customers.find((c) => c.phone === phone);
        if (hit) return hit;
        const row = { id: `c-${++seq}`, full_name, phone, address };
        store.customers.push(row);
        return row;
      },
      updateStatus: async () => ({}),
      getTicket: async () => ({}),
      RATING_LABELS: {},
    },
  });
  mock.module(url("../src/services/push.js"), { namedExports: { sendPush: async () => {} } });
  mock.module(url("../src/services/invoice.js"), { namedExports: { issueInvoiceForTicket: async () => ({}) } });

  ({ createMyCall } = await import(url("../src/services/techJobs.js")));
});

beforeEach(() => resetWorld());

const customerNotifs = () => notifCalls.filter((n) => n.audience === "customer");

test("a first call creates the ticket and tells the customer once", async () => {
  const job = await createMyCall(TECH_ID, CALL, "c_abc123");
  assert.equal(store.tickets.length, 1);
  assert.equal(store.tickets[0].client_id, "c_abc123");
  assert.equal(customerNotifs().length, 1);
  assert.ok(job.id);
});

test("the outbox replaying the same call does NOT create a second ticket", async () => {
  const first = await createMyCall(TECH_ID, CALL, "c_abc123");
  const replay = await createMyCall(TECH_ID, CALL, "c_abc123");

  assert.equal(store.tickets.length, 1, "one call, one ticket");
  assert.equal(replay.id, first.id, "the replay must get the ticket it already made");
  assert.equal(customerNotifs().length, 1, "the customer must not be messaged twice");
  assert.equal(notifCalls.length, 2, "one customer + one manager, from the first attempt only");
});

test("two replays landing together: the unique index refuses the loser", async () => {
  // Both look before either writes, so both find nothing — the lookup alone
  // cannot stop this. The index does, and the 23505 becomes the winner's ticket.
  const [a, b] = await Promise.all([
    createMyCall(TECH_ID, CALL, "c_race"),
    createMyCall(TECH_ID, CALL, "c_race"),
  ]);
  assert.equal(store.tickets.length, 1);
  assert.equal(a.id, b.id, "both callers must be handed the same ticket");
});

test("two genuinely different calls are still two tickets", async () => {
  await createMyCall(TECH_ID, CALL, "c_one");
  await createMyCall(TECH_ID, { ...CALL, problem: "LEAKING" }, "c_two");
  assert.equal(store.tickets.length, 2);
  assert.equal(customerNotifs().length, 2);
});

test("a call with no mobile number is refused, and says why", async () => {
  /* This used to reach an insert of phone: null into a NOT NULL column, so the
     technician got "Something went wrong" and no idea which field was at fault.
     The number is not optional: it is how the customer is reached at all. */
  await assert.rejects(
    () => createMyCall(TECH_ID, { ...CALL, phone: "" }, "c_nophone"),
    (e) => e.status === 400 && /mobile number is required/i.test(e.message));
  assert.equal(store.tickets.length, 0, "and nothing is half-created");
  assert.equal(store.customers.length, 0);
});

test("a number that is not a real mobile is refused too", async () => {
  await assert.rejects(
    () => createMyCall(TECH_ID, { ...CALL, phone: "12345" }, "c_badphone"),
    (e) => e.status === 400);
  assert.equal(store.tickets.length, 0);
});

test("if the migration has not been applied, the call still goes through", async () => {
  /* The failure this reproduces actually happened: the backend went out before
     db/phase8_tech_call_idempotency.sql was applied, the app had started sending
     client_id, and every New Call came back "Something went wrong". A missing
     column may cost the idempotency; it must not cost the feature. */
  columnMissing = true;
  try {
    const job = await createMyCall(TECH_ID, CALL, "c_abc123");
    assert.equal(store.tickets.length, 1, "the call is recorded");
    assert.equal(store.tickets[0].client_id, undefined, "just without the id it cannot store");
    assert.ok(job.id);
    assert.equal(customerNotifs().length, 1, "and the customer still hears back");
  } finally {
    columnMissing = false;
  }
});

test("a call made online, with no client_id, behaves exactly as before", async () => {
  // The dashboard and any older build send none; nothing may depend on it.
  await createMyCall(TECH_ID, CALL);
  await createMyCall(TECH_ID, CALL);
  assert.equal(store.tickets.length, 2, "without an id there is nothing to match on");
  assert.equal(store.tickets[0].client_id, undefined);
});
