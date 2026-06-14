// Central registry of approved WhatsApp (Meta) message templates.

export const WA_LANG = "en";

function v(val) {
  const s = String(val ?? "").replace(/[\t\n\r]+/g, " ").replace(/ {5,}/g, "    ").trim();
  return s || "—";
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

export function technicianNewJob({ ticketNumber, customerName, customerPhone, address, issue }) {
  return {
    template: {
      name: "technician_new_job",
      language: WA_LANG,
      variables: [v(ticketNumber), v(customerName), v(customerPhone), v(address), v(issue)],
    },
    body:
      ` New assignment ${ticketNumber}\n` +
      `Customer: ${customerName} (${customerPhone})\n` +
      `Address: ${address || "N/A"}\n` +
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
