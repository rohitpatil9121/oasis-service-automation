/* Which column of the manager's board a ticket lands in.

   The rules are small but they decide what the office looks at each morning,
   and they have been got wrong twice — once by filing half-collected requests
   under New, once by reading a closed job as an open one. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { boardBucket } from "../src/lib/boardBucket.js";

const nowISO = () => new Date().toISOString();
const yesterdayISO = () => new Date(Date.now() - 30 * 3600 * 1000).toISOString();

const ticket = (over = {}) => ({
  status: "NEW",
  intake_complete: true,
  assigned_technician_id: null,
  created_at: nowISO(),
  ...over,
});

test("a complete request raised today is New", () => {
  assert.equal(boardBucket(ticket()), "new");
});

test("a complete request from an earlier day is Pending", () => {
  assert.equal(boardBucket(ticket({ created_at: yesterdayISO() })), "pending");
});

/* The bot opens the request the moment someone asks for service — before it
   knows the fault or the address. Those cannot be dispatched to anybody, so
   they belong with the work that needs chasing, however new they are. */
test("an unfinished intake is Pending even when raised today", () => {
  assert.equal(boardBucket(ticket({ intake_complete: false })), "pending");
});

test("finishing the intake moves it into New", () => {
  const draft = ticket({ intake_complete: false });
  assert.equal(boardBucket(draft), "pending");
  assert.equal(boardBucket({ ...draft, intake_complete: true }), "new");
});

test("assignment beats everything else that is still open", () => {
  assert.equal(
    boardBucket(ticket({ intake_complete: false, assigned_technician_id: "t-1" })),
    "assigned",
  );
});

test("a reopened request is Pending, not New", () => {
  assert.equal(boardBucket(ticket({ reopened_at: nowISO() })), "pending");
});

test("cancelled and closed are unaffected by the intake flag", () => {
  assert.equal(boardBucket(ticket({ status: "CANCELLED", intake_complete: false })), "cancelled");
  const closed = ticket({ status: "CLOSED", intake_complete: false, closed_at: nowISO() });
  assert.equal(boardBucket(closed), "service_done");
});
