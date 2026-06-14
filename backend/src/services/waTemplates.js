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
