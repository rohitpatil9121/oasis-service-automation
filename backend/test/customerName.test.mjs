// A phone number is not a name.
//
// One customer sits on record as "7798705160" — his own number typed into the
// name field — so the cancellation he received opened "Hi 7798705160". Holding
// no name is better: every message that greets by name already copes with a
// blank one, and the office can see the field is empty and ask.
//
// Run: node --test --experimental-test-module-mocks test/customerName.test.mjs

import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

let looksLikePhoneNumber;

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;
  // Only supabase is stubbed — the function under test is the real one.
  mock.module(url("../src/config/supabase.js"), { namedExports: { supabase: { from: () => ({}) } } });
  ({ looksLikePhoneNumber } = await import(url("../src/services/tickets.js")));
});

test("a number offered as a name is recognised, however it is written", () => {
  for (const v of ["7798705160", "+91 77987 05160", "+917798705160", "077-9870-5160", "(772) 870-5160"]) {
    assert.equal(looksLikePhoneNumber(v), true, v);
  }
});

test("a real name is left alone", () => {
  for (const v of ["Rahul Wandile", "Nitin Ghatole", "PANDE"]) {
    assert.equal(looksLikePhoneNumber(v), false, v);
  }
});

test("a name that merely contains digits is still a name", () => {
  // "A-702 Rahul" is a flat number and a name; refusing it would lose both.
  for (const v of ["A-702 Rahul", "Nitin 9822011223", "Flat 12 Sharma"]) {
    assert.equal(looksLikePhoneNumber(v), false, v);
  }
});

test("empty and missing are not numbers", () => {
  for (const v of ["", "   ", null, undefined]) {
    assert.equal(looksLikePhoneNumber(v), false, String(v));
  }
});

test("a short number is not treated as a phone", () => {
  // House numbers, floor numbers, PINs a customer might send alone.
  for (const v of ["702", "12", "411057"]) {
    assert.equal(looksLikePhoneNumber(v), false, v);
  }
});
