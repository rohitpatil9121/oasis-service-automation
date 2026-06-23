// Central registry of approved WhatsApp (Meta) message templates.

export const WA_LANG = "en";

function v(val) {
  const s = String(val ?? "").replace(/[\t\n\r]+/g, " ").replace(/ {5,}/g, "    ").trim();
  return s || "—";
}

// Sent to the CUSTOMER when the Service Manager creates a request on their
// behalf (e.g. a KENT-referred lead). The customer hasn't messaged us, so we're
// outside the 24-hour window — this approved template is how we open the chat.
// {{2}} is the lead source ("KENT" / "our service team").
export function customerRequestReceived({ customerName, source, ticketNumber, issue, address }) {
  return {
    template: {
      name: "customer_request_received",
      language: WA_LANG,
      variables: [v(customerName), v(source), v(ticketNumber), v(issue), v(address)],
    },
    body:
      `Hello ${customerName}, we have received your water purifier service request from ${source}.\n\n` +
      `Service request ID: ${ticketNumber}\n` +
      `Service: ${issue}\n` +
      `Address: ${address || "N/A"}\n\n` +
      `We will assign a technician and update you here.\n\n` +
      `If any detail is incorrect, please reply to this message.`,
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
