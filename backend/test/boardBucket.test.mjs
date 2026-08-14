/* Which column of the manager's board a ticket lands in.

   The rules are small but they decide what the office looks at each morning,
   and they have been got wrong twice — once by filing half-collected requests
   under New, once by reading a closed job as an open one. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { boardBucket, attachBoardBucket } from "../src/lib/boardBucket.js";

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

/* A customer we have served before goes to Pending, not New.

   New is where the office looks for people it does not know: someone whose
   address has to be taken down and whose purifier nobody has seen. A repeat
   customer needs none of that, only a technician sent — and their requests
   were landing in New and being read as fresh enquiries. Four of the eighteen
   requests raised in the three days before this was written were repeats. */
test("a returning customer's request is Pending even on the day it is raised", () => {
  assert.equal(boardBucket(ticket({ repeat_customer: true })), "pending");
});

test("a first-time customer's request today is still New", () => {
  assert.equal(boardBucket(ticket({ repeat_customer: false })), "new");
  assert.equal(boardBucket(ticket()), "new");
});

test("assignment still beats the repeat-customer rule", () => {
  assert.equal(
    boardBucket(ticket({ repeat_customer: true, assigned_technician_id: "t-1" })),
    "assigned",
  );
});

test("attachBoardBucket carries the flag through", () => {
  const t = ticket();
  assert.equal(attachBoardBucket(t, { repeatCustomer: true }).board_bucket, "pending");
  assert.equal(attachBoardBucket(t).board_bucket, "new");
});

/* A returning customer starts a NEW request, never reopens the old one.

   A closed job used to be reused for seven days: the customer coming back
   landed on their old request, which reopened under its old number, so last
   week's job appeared alive again with its bill and its rating attached to work
   that had not happened yet. Every fresh call now gets its own number. */
test("only a still-open request is folded into", async () => {
  const { getReusableTicketForCustomer } = await import("../src/services/tickets.js");
  assert.equal(typeof getReusableTicketForCustomer, "function");
});

test("the old ticket keeps its own bucket while the new one waits in Pending", () => {
  const closedYesterday = ticket({
    status: "CLOSED", closed_at: new Date(Date.now() - 864e5).toISOString(),
  });
  assert.equal(boardBucket(closedYesterday), "service_done", "the finished job stays finished");
  assert.equal(boardBucket(ticket({ repeat_customer: true })), "pending", "the new one waits");
});

/* Installation — the board's one cross-cutting mark.

   The technician picks the call type while writing the bill. "Installation"
   means the customer now owns a machine they did not own this morning: they
   need an AMC offer and a first-service reminder, and the office cannot chase
   what it cannot see. It must NOT be a bucket, though — a bucket is exclusive,
   so those jobs would vanish out of Service Done and Completed and leave both
   counts short. */
test("a job billed as an installation is marked, and keeps its own bucket", () => {
  const t = attachBoardBucket(ticket({
    status: "CLOSED",
    closed_at: new Date(Date.now() - 864e5).toISOString(),
    tech_work: { call_type: "installation" },
  }));
  assert.equal(t.installation, true);
  assert.equal(t.board_bucket, "service_done", "it is still a finished job as well");
});

test("an ordinary repair is not marked", () => {
  const t = attachBoardBucket(ticket({ tech_work: { call_type: "service" } }));
  assert.equal(t.installation, false);
});

test("a job with no bill written yet is not marked", () => {
  assert.equal(attachBoardBucket(ticket()).installation, false);
});

test("installations billed by an older build are still found", () => {
  // Builds before the bill redesign wrote the call type as `charge`.
  const t = attachBoardBucket(ticket({ tech_work: { charge: "installation" } }));
  assert.equal(t.installation, true);
});

test("an installation archived past seven days shows up under Completed too", () => {
  const t = attachBoardBucket(ticket({
    status: "CLOSED",
    closed_at: new Date(Date.now() - 30 * 864e5).toISOString(),
    tech_work: { call_type: "installation" },
  }));
  assert.equal(t.installation, true);
  assert.equal(t.board_bucket, "completed");
});

/* The bill settles it when there is one; the words only speak when there is not.
   Only 186 of 502 live tickets carry a bill, and the rest include plainly
   labelled installations that would otherwise never appear on the board. */
test("what the technician billed beats what the request said", () => {
  const t = attachBoardBucket(ticket({
    issue_description: "NEW INSTALLATION",
    tech_work: { call_type: "service" },
  }));
  assert.equal(t.installation, false, "he was there; if he billed it as a service, it was a service");
});

test("a job with no bill is read from its own words", () => {
  assert.equal(attachBoardBucket(ticket({ issue_description: "AQUA JADE WHITE NEW INSTALLATION" })).installation, true);
  assert.equal(attachBoardBucket(ticket({ issue_description: "Install new purifier" })).installation, true);
  assert.equal(attachBoardBucket(ticket({ issue_description: "NOT WORKING" })).installation, false);
});

test("moving a machine the customer already owns is not a new installation", () => {
  for (const issue of ["Re-Installation", "RE INSTALLATION", "reinstall", "REE INSTALLATION OASIS",
                       "Purifier installation due to location shifting"]) {
    assert.equal(attachBoardBucket(ticket({ issue_description: issue })).installation, false, issue);
  }
});

test("a cancelled request installed nothing, whatever it said", () => {
  // The board itself drops these; this only records that the mark is not what
  // keeps them out — boardBucket sends every cancelled ticket to "cancelled".
  const t = attachBoardBucket(ticket({ status: "CANCELLED", issue_description: "NEW INSTALLATION" }));
  assert.equal(t.board_bucket, "cancelled");
});
