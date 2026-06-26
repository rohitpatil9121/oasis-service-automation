// Company knowledge base for the WhatsApp agent's FAQ flow (Flow 3).
// The agent answers general questions (services, brands, areas, timings, AMC)
// ONLY from this object — it must not invent facts. Anything left null/empty
// makes the agent say "our team will confirm", so it's safe to leave gaps.
//
// >>> OWNER: edit the values below to match the real business. <<<
// The lines marked EDIT are best-guess starters — confirm them before going live.

export const COMPANY_INFO = {
  about:
    "Oasis Globe provides water purifier (RO / UV / UF) installation, servicing, " +
    "repair and AMC for homes and offices.",

  services: [
    "Purifier repair — leakage, low flow, not working, bad taste/smell, noise",
    "Filter / cartridge / membrane replacement",
    "Annual Maintenance Contract (AMC)",
    "New installation and relocation",
  ],

  brands_serviced: [
    "Kent", "Aquaguard / Eureka Forbes", "Pureit / HUL",
    "Livpure", "AO Smith", "most other RO/UV brands",
  ], // EDIT: trim/extend to the brands you actually service

  service_areas: ["Wakad", "Kaspate Wasti", "and nearby Pune areas"], // EDIT: real coverage

  working_hours: "Monday to Saturday, 9:00 AM to 7:00 PM", // EDIT: confirm

  response_time:
    "A technician is usually assigned the same day or the next working day.", // EDIT

  amc:
    "AMC covers periodic servicing and filter checks. Ask our team for the current " +
    "AMC plans and what they include.", // EDIT: add real plan names/details when ready

  // Only the approved figure goes here — the agent must quote ONLY this and never
  // guess a number. Service/visit charge is ₹250; parts/repairs are extra and the
  // technician confirms the amount before proceeding.
  pricing:
    "Service charge is ₹250, payable after the service. Any spare parts or repair " +
    "cost is extra, and the technician confirms the amount before proceeding.",

  contact:
    "Just reply here on WhatsApp anytime. Send 'status' to track an existing request.",
};
