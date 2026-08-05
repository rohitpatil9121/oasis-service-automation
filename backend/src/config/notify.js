/* Which messages the CUSTOMER receives on WhatsApp.

   Owner's decision (3 Aug 2026): customers were getting too many messages during a
   single job — estimate, approval, work-done, payment, bill — several of which
   repeated when the technician re-saved. Only the milestones a customer actually
   needs are sent now.

   This is a policy switch, not dead code: every template still exists and is still
   approved with Meta, so any line can be turned back on by flipping it to true.
   Staff/technician/manager notifications are NOT affected — only `audience: "customer"`.

   Anything set to false here must also be justified in the comment beside it,
   because turning a customer message off has consequences elsewhere in the flow. */

export const CUSTOMER_NOTIFY = {
  // ---- Kept: the four milestones the customer asked to keep ----
  requestReceived: true,     // "Your service request has been logged" + ticket number
  technicianAssigned: true,  // "Technician assigned: <name>"
  workCompleted: true,       // "Work completed. Please pay ₹X to the technician now"
  invoice: true,             // the tax invoice / bill (with PDF)

  // ---- Kept: not informational, these do a job ----
  arrivalOtp: true,          // 4-digit code the technician needs to verify arrival
  cancelled: true,           // otherwise a customer waits for a technician who never comes
  ratingRequest: true,       // the only source of service feedback and star ratings

  // ---- Turned off ----

  // "Visit scheduled for <when>". The customer already knows a technician is coming
  // from technicianAssigned; the slot is confirmed by the technician directly.
  visitScheduled: false,

  // "Estimate for OG-… Total: ₹X. The technician has started the work."
  // NOTE: this message carried the Approve / Reject quick-reply buttons. With it off,
  // the customer can no longer approve an estimate over WhatsApp, so the technician
  // stops receiving approve/reject push notifications. In practice the technician was
  // already proceeding without waiting (estimate and work-done land seconds apart),
  // and the estimate is shown to the customer in person.
  estimate: false,

  // "Your estimate is approved" — only ever fired in reply to the estimate message
  // above, so it is unreachable once `estimate` is off.
  estimateApproved: false,

  // "Payment of ₹X received via <mode>". Redundant: the invoice that follows states
  // the amount and the payment mode, and the customer just paid in person.
  paymentReceived: false,
};
