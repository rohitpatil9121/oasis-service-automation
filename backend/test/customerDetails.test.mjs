/* Saved customer details must survive a returning customer echoing them back.

   KHULA RASSA WAKAD answered a greeting with "Khula Rassa", then "Wakad". Both
   are pieces of what was already on file, and both were saved as corrections —
   the stored address went from a Google Maps pin to the single word "Wakad",
   which is what the technician would then have been sent to find them with.

   A real correction always introduces something we did not have. A fragment of
   the stored value cannot, so it is ignored. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isFragmentOf } from "../src/services/tickets.js";

test("pieces of the stored value are recognised as fragments", () => {
  assert.ok(isFragmentOf("Khula Rassa", "KHULA RASSA WAKAD"));
  assert.ok(isFragmentOf("Wakad", "https://maps.app.goo.gl/XXW1ina5d1xR1t6W9\nKHULA RASSA WAKAD"));
  assert.ok(isFragmentOf("baner", "Flat 9, Crystal Residency, Baner"));
  assert.ok(isFragmentOf("  KHULA   RASSA  ", "Khula Rassa Wakad"), "spacing and case are ignored");
});

test("a genuine correction is not a fragment", () => {
  assert.ok(!isFragmentOf("Flat 12, Sunrise Society, Wakad", "Wakad"));
  assert.ok(!isFragmentOf("Rakesh Sharma", "KHULA RASSA WAKAD"));
  assert.ok(!isFragmentOf("Baner", "Wakad"));
});

test("empty values are never fragments", () => {
  assert.ok(!isFragmentOf("", "KHULA RASSA WAKAD"));
  assert.ok(!isFragmentOf("Wakad", ""));
  assert.ok(!isFragmentOf(null, undefined));
});
