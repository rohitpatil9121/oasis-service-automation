// Central registry of approved WhatsApp (Meta) message templates.

export const WA_LANG = "en";

function v(val) {
  const s = String(val ?? "").replace(/[\t\n\r]+/g, " ").replace(/ {5,}/g, "    ").trim();
  return s || "—";
}

// One source of truth for the customer-facing "Service Issue:" line in free-text
// messages. Returns the line (with a trailing blank line) when there's a real
// issue, or "" so we NEVER send a blank/placeholder "Service Issue: —" to the
// customer. (Meta-template variables can't be empty, so those still use v() above.)
export function serviceLine(issue) {
  const s = String(issue ?? "").trim();
  return s ? `Service Issue: ${s}\n\n` : "";
}

// Sent to the CUSTOMER when the Service Manager creates a request on their
// behalf (e.g. a KENT-referred lead). The customer hasn't messaged us, so we're
// outside the 24-hour window — this approved template is how we open the chat.
// {{2}} is the lead source ("KENT" / "our service team").
// {{1}} name  {{2}} ticket  {{3}} issue  {{4}} address
export function customerRequestReceived({ customerName, ticketNumber, issue, address }) {
  return {
    template: {
      name: "customer_request_received",
      language: WA_LANG,
      variables: [v(customerName), v(ticketNumber), v(issue), v(address)],
    },
    body:
      `Hi ${customerName}, request logged.\n` +
      `ID: ${ticketNumber}\n` +
      `Issue: ${issue}\n` +
      `Address: ${address || "N/A"}\n` +
      `We'll assign a technician and update you here.`,
  };
}

export function managerNewRequest({ ticketNumber, customerName, customerPhone, address, issue }) {
  return {
    template: {
      name: "manager_new_request",
      language: WA_LANG,
      variables: [v(ticketNumber), v(customerName), v(customerPhone), v(address), v(issue)],
    },
    body:
      ` New service request ${ticketNumber}\n` +
      `Customer: ${customerName} (${customerPhone})\n` +
      `Address: ${address || "N/A"}\n` +
      `Issue: ${issue}`,
  };
}

export function technicianNewJob({ ticketNumber, customerName, customerPhone, address, appliance, issue }) {
  return {
    template: {
      name: "technician_new_job",
      language: WA_LANG,
      // 6 placeholders ({{1}}–{{6}}): ticket, customer, phone, address,
      // appliance, issue. The Meta template MUST have all 6 or it fails with
      // error #132000 (number of parameters does not match).
      variables: [v(ticketNumber), v(customerName), v(customerPhone), v(address), v(appliance), v(issue)],
    },
    body:
      ` New assignment ${ticketNumber}\n` +
      `Customer: ${customerName} (${customerPhone})\n` +
      `Address: ${address || "N/A"}\n` +
      (appliance ? `Appliance: ${appliance}\n` : "") +
      `Issue: ${issue}`,
  };
}

// {{1}} ticket  {{2}} customer name  {{3}} customer phone  {{4}} when  {{5}} address
export function visitScheduledTechnician({ ticketNumber, customerName, customerPhone, address, when }) {
  return {
    template: {
      name: "visit_scheduled_technician",
      language: WA_LANG,
      variables: [v(ticketNumber), v(customerName), v(customerPhone), v(when), v(address)],
    },
    body:
      `Visit scheduled ${ticketNumber}\n` +
      `Customer: ${customerName} (${customerPhone})\n` +
      `When: ${when}\n` +
      `Address: ${address || "N/A"}`,
  };
}

// {{1}} customer name  {{2}} when  {{3}} ticket
export function visitScheduledCustomer({ ticketNumber, customerName, when }) {
  return {
    template: {
      name: "visit_scheduled_customer",
      language: WA_LANG,
      variables: [v(customerName), v(when), v(ticketNumber)],
    },
    body:
      `Hi ${customerName}, your Oasis Globe service visit is scheduled for ${when}. ` +
      `Ref: ${ticketNumber}`,
  };
}

// Sent to the CUSTOMER when the Service Manager CLOSES (completes) a request and
// the 24-hour window has lapsed — free-form text / interactive buttons would
// silently fail there, so this approved template guarantees delivery.
// {{1}} customer name  {{2}} ticket  {{3}} service/issue
// {{1}} ticket
export function requestCompletedCustomer({ ticketNumber }) {
  return {
    template: {
      name: "request_completed_customer",
      language: WA_LANG,
      variables: [v(ticketNumber)],
    },
    body:
      `Your service request ${ticketNumber} is complete.\n` +
      `How was our service? Tap below to rate us.`,
  };
}

// Login OTP for staff (technicians/managers). They usually haven't messaged the
// business, so the code can't go as free-form text (24-hour rule) — this
// approved template delivers it any time.
//
// This is an Authentication-category template: Meta fixes the body wording and
// it has exactly ONE variable (the code). The expiry is configured on the
// template itself, not passed as a variable. `otpCode` tells the Meta sender to
// also bind the code to the copy-code button (Meta requires that parameter).
export function loginOtp({ code }) {
  return {
    template: {
      name: "login_otp",
      language: WA_LANG,
      variables: [v(code)],
      otpCode: String(code),
    },
    body: `${code} is your Oasis Globe login code. Do not share it with anyone.`,
  };
}

// ---------------------------------------------------------------------------
// Technician-workflow milestones sent to the CUSTOMER. These used to go as
// free-form text and silently failed whenever the customer was outside the
// 24-hour window (manager/KENT-referred leads, or any gap > 24h). Each is now an
// approved template so it delivers any time. `body` stays as the readable
// fallback (Twilio/mock, and the free-text fallback in queueNotification).
// ---------------------------------------------------------------------------

// {{1}} ticket  {{2}} technician name  {{3}} service/issue
// {{1}} technician name
export function customerTechnicianAssigned({ techName }) {
  return {
    template: {
      name: "customer_technician_assigned",
      language: WA_LANG,
      variables: [v(techName)],
    },
    body:
      `Technician assigned: ${techName}.\n` +
      `You'll get an update when he starts.`,
  };
}

// {{1}} ticket  {{2}} technician name  {{3}} ETA in minutes
export function customerTechnicianEnroute({ ticketNumber, techName, etaMinutes = "30" }) {
  return {
    template: {
      name: "customer_technician_enroute",
      language: WA_LANG,
      variables: [v(ticketNumber), v(techName), v(etaMinutes)],
    },
    body:
      `Technician is on the way for your request ${ticketNumber}.\n` +
      `Name: ${techName}\n` +
      `ETA: Around ${etaMinutes} minutes.`,
  };
}

// Arrival code the customer reads out to the on-site technician. Meta forces any
// verification code into the AUTHENTICATION category (Utility submits get
// rejected), so this is an Authentication template: Meta fixes the body wording,
// it has exactly ONE variable (the code), and the code must also be bound to the
// copy-code button — same shape as loginOtp. `otpCode` tells the Meta sender to
// bind it to that button. No ticket/context is possible in this category.
export function customerArrivalOtp({ code }) {
  return {
    template: {
      name: "customer_arrival_otp",
      language: WA_LANG,
      variables: [v(code)],
      otpCode: String(code),
    },
    body: `OTP: ${code}.\nShare it only when the technician reaches you.`,
  };
}

// {{1}} ticket  {{2}} problem  {{3}} itemised charges (single line)  {{4}} total.
// The itemised parts list is collapsed into ONE comma-joined variable so it fits
// a fixed-shape template (Meta can't have a variable number of {{n}}). The full
// readable bill is passed as `body` for the fallback path.
export function customerEstimate({ ticketNumber, problem, charges, total, body }) {
  return {
    template: {
      name: "customer_estimate",
      language: WA_LANG,
      variables: [v(ticketNumber), v(problem), v(charges), v(total)],
    },
    body:
      body ||
      `Estimate for your request ${ticketNumber}.\n` +
      `Problem: ${problem || "—"}\n` +
      `Charges: ${charges}\n` +
      `Total: ${total}\n\n` +
      `Reply 1 to Approve or 2 to Reject.`,
  };
}

// {{1}} ticket
export function customerEstimateApproved({ ticketNumber }) {
  return {
    template: {
      name: "customer_estimate_approved",
      language: WA_LANG,
      variables: [v(ticketNumber)],
    },
    body:
      `Estimate approved for request ${ticketNumber}.\n\n` +
      `The technician has started the work.`,
  };
}

// {{1}} ticket  {{2}} amount due
// {{1}} amount due
export function customerWorkCompleted({ amount }) {
  return {
    template: {
      name: "customer_work_completed",
      language: WA_LANG,
      variables: [v(amount)],
    },
    body:
      `Work completed.\n` +
      `Please pay ${amount} to the technician now.`,
  };
}

// {{1}} ticket  {{2}} visit charge payable
export function customerVisitCharge({ ticketNumber, amount }) {
  return {
    template: {
      name: "customer_visit_charge",
      language: WA_LANG,
      variables: [v(ticketNumber), v(amount)],
    },
    body:
      `Repair not approved for your request ${ticketNumber}.\n\n` +
      `Visit charge payable: ${amount}\n\n` +
      `Please pay the visit charge in the technician's presence.`,
  };
}

// {{1}} ticket  {{2}} amount  {{3}} payment mode
// {{1}} amount  {{2}} payment mode  {{3}} ticket
export function customerPaymentReceived({ ticketNumber, amount, mode }) {
  return {
    template: {
      name: "customer_payment_received",
      language: WA_LANG,
      variables: [v(amount), v(mode), v(ticketNumber)],
    },
    body:
      `Payment of ${amount} received via ${mode}.\n` +
      `ID: ${ticketNumber}\n` +
      `Thank you for choosing Oasis Globe.`,
  };
}

// {{1}} customer name  {{2}} ticket  {{3}} reason
export function requestCancelledCustomer({ ticketNumber, customerName, reason }) {
  return {
    template: {
      name: "request_cancelled_customer",
      language: WA_LANG,
      variables: [v(customerName), v(ticketNumber), v(reason)],
    },
    body:
      `Hi ${customerName}, your Oasis Globe service request ${ticketNumber} has been cancelled. ` +
      `Reason: ${reason}\n` +
      `If this isn't right or you'd like to raise it again, just reply here.`,
  };
}
