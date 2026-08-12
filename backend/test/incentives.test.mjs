/* The incentive rules, pinned.

   These are money rules, so each one is asserted with a concrete number rather
   than re-deriving the formula the code already contains — a test that repeats
   the implementation cannot catch the implementation changing.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import { RULES, partIncentive, paymentMode, summariseDay } from "../src/services/incentives.js";

// price 550, our cost 300  ->  margin 250
const CATALOG = new Map([
  ["kent-1", { name: "Kent sediment", brand: "kent", base_cost: 0 }],
  ["aqua-1", { name: "AG kit", brand: "aquaguard", base_cost: 0 }],
  ["oasis-1", { name: "Oasis carbon", brand: "oasis", base_cost: 300 }],
  ["oasis-nocost", { name: "Oasis elbow", brand: "oasis", base_cost: 0 }],
  ["plain-1", { name: "Generic elbow", brand: null, base_cost: 0 }],
]);
const pay = (id, price, qty, rate, mode) =>
  partIncentive({ id, price, qty }, CATALOG, rate, mode).payout;

test("GST comes off the Oasis margin whether the job was paid in cash or online", () => {
  // 550 - 300 = 250 margin, less 18% = 205. Both modes must agree.
  assert.equal(pay("oasis-1", 550, 1, RULES.BRAND_RATE, "cash"), 205);
  assert.equal(pay("oasis-1", 550, 1, RULES.BRAND_RATE, "online"), 205);
  assert.equal(
    pay("oasis-1", 550, 1, RULES.BRAND_RATE, "cash"),
    pay("oasis-1", 550, 1, RULES.BRAND_RATE, "online"),
    "cash and online must pay the same",
  );
});

test("the daily rate does not touch Oasis parts", () => {
  assert.equal(pay("oasis-1", 550, 1, RULES.BRAND_RATE, "cash"), 205);
  assert.equal(pay("oasis-1", 550, 1, RULES.BRAND_RATE_BONUS, "cash"), 205);
});

test("branded parts pay a flat percentage of the price, unaffected by payment mode", () => {
  assert.equal(pay("kent-1", 550, 1, RULES.BRAND_RATE, "cash"), 36.08);       // 550 x 8% x 0.82
  assert.equal(pay("kent-1", 550, 1, RULES.BRAND_RATE_BONUS, "cash"), 45.1); // 550 x 10% x 0.82
  assert.equal(pay("kent-1", 550, 1, RULES.BRAND_RATE_BONUS, "online"), 45.1);
  assert.equal(pay("aqua-1", 1840, 1, RULES.BRAND_RATE, "cash"), 120.7);
});

test("quantity multiplies both kinds of payout", () => {
  assert.equal(pay("kent-1", 550, 2, RULES.BRAND_RATE_BONUS, "cash"), 90.2);
  assert.equal(pay("oasis-1", 550, 2, RULES.BRAND_RATE, "cash"), 410); // 250 x 2 x 0.82
});

test("a part with no brand pays nothing", () => {
  assert.equal(pay("plain-1", 500, 1, RULES.BRAND_RATE_BONUS, "cash"), 0);
});

test("an unknown part pays nothing rather than throwing", () => {
  assert.equal(pay("not-in-catalog", 500, 1, RULES.BRAND_RATE, "cash"), 0);
});

test("margin never goes negative when a part sells below cost", () => {
  const dear = new Map([["x", { name: "x", brand: "oasis", base_cost: 900 }]]);
  assert.equal(partIncentive({ id: "x", price: 500, qty: 1 }, dear, RULES.BRAND_RATE, "cash").payout, 0);
});

test("an Oasis part with no cost on file pays out almost its whole price", () => {
  // Documents today's live state: 50 parts sit like this, so the guard against
  // it silently changing is worth having.
  assert.equal(pay("oasis-nocost", 100, 1, RULES.BRAND_RATE, "cash"), 82);
});

test("paymentMode still reports how the job was paid", () => {
  assert.equal(paymentMode([{ method: "upi", amount: 500 }]), "online");
  assert.equal(paymentMode([{ method: "cash", amount: 500 }]), "cash");
  assert.equal(paymentMode([{ method: "cash", amount: 600 }, { method: "upi", amount: 400 }]), "cash");
  assert.equal(paymentMode([]), "cash", "nothing collected yet reads as cash");
});

test("hitting the daily target lifts branded parts for the whole day, retroactively", () => {
  const tickets = [
    { id: 1, ticket_number: "OG-1", tech_work: { total: 2000, payments: [{ method: "cash", amount: 2000 }], parts: [{ id: "kent-1", price: 1000, qty: 1 }] } },
    { id: 2, ticket_number: "OG-2", tech_work: { total: 9000, payments: [{ method: "cash", amount: 9000 }], parts: [{ id: "kent-1", price: 1000, qty: 1 }] } },
  ];
  const day = summariseDay(tickets, CATALOG);
  assert.equal(day.billing, 11000);
  assert.equal(day.target_hit, true);
  assert.equal(day.brand_rate, RULES.BRAND_RATE_BONUS);
  // Both jobs pay 10%, including the one closed before the target was reached.
  assert.equal(day.jobs[0].payout, 82); // 1000 x 10% x 0.82
  assert.equal(day.payout, 164); // two jobs x 82
});

test("below the target the same day pays the base rate", () => {
  const tickets = [
    { id: 1, ticket_number: "OG-1", tech_work: { total: 2000, payments: [{ method: "cash", amount: 2000 }], parts: [{ id: "kent-1", price: 1000, qty: 1 }] } },
  ];
  const day = summariseDay(tickets, CATALOG);
  assert.equal(day.target_hit, false);
  assert.equal(day.payout, 65.6); // 1000 x 8% x 0.82
});

test("the service charge earns nothing but still counts toward the target", () => {
  // A job with no parts: bills 10,000, pays 0, and on its own unlocks the bonus.
  const tickets = [
    { id: 1, ticket_number: "OG-1", tech_work: { total: 10000, payments: [{ method: "cash", amount: 10000 }], parts: [] } },
  ];
  const day = summariseDay(tickets, CATALOG);
  assert.equal(day.billing, 10000);
  assert.equal(day.target_hit, true);
  assert.equal(day.payout, 0);
});

/* GST comes off both rules, not just Oasis.

   Kent and Aquaguard were paid a straight percentage of MRP. MRP includes the
   tax, so that quietly paid commission on the tax as well — the Oasis side had
   the cut and the branded side did not (owner's decision, 12 Aug 2026). */
test("the branded percentage is taken after GST, like the Oasis margin", () => {
  // 3,100 x 8% = 248 gross, of which the technician keeps 82%.
  assert.equal(pay("kent-1", 3100, 1, RULES.BRAND_RATE, "cash"), 203.36);
  assert.equal(pay("kent-1", 3100, 1, RULES.BRAND_RATE_BONUS, "cash"), 254.2);
});

test("the gross figure is reported alongside so a payout can be checked", () => {
  const line = partIncentive({ id: "kent-1", price: 3100, qty: 1 }, CATALOG, RULES.BRAND_RATE, "cash");
  assert.equal(line.gross, 248);   // what the rate alone comes to
  assert.equal(line.payout, 203.36); // what is actually paid
});

test("payment mode still makes no difference to either rule", () => {
  assert.equal(
    pay("kent-1", 3100, 1, RULES.BRAND_RATE, "cash"),
    pay("kent-1", 3100, 1, RULES.BRAND_RATE, "online"),
  );
});
