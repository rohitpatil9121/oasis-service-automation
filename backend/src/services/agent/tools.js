// Tool definitions sent to the model. The WHOLE list is re-sent on every step of
// every message, so an unused tool is a per-message cost — see getToolDefs() below.
import { env } from "../../config/env.js";

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "identify_customer",
      description:
        "Look up this customer: saved name, address, and any open request. Call FIRST in a " +
        "new conversation so you never re-ask details we already have.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "save_customer_details",
      description:
        "Save/update the customer's name and/or address. Call whenever they give a name or address.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer's full name" },
          address: { type: "string", description: "Service address for the technician visit" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_or_get_request",
      description:
        "Start the request (reuses their open one if any). Call before saving the issue.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_request",
      description:
        "Add/update details on the current request. Call whenever the customer gives a " +
        "name, symptom, appliance, address, or extra info. Pass a field's FULL combined value.",
      parameters: {
        type: "object",
        properties: {
          issue: { type: "string", description: "What is wrong, e.g. 'water leaking', 'low flow', 'not working'" },
          appliance: { type: "string", description: "Purifier brand/model if mentioned, e.g. 'Kent RO'" },
          // Also accepted here, not only on save_customer_details. A customer who
          // sends "Suresh Patil, Flat 9 Shivaji Nagar" gives both at once, and the
          // model would put them in one update_request call and silently lose the
          // name — leaving intake stuck with a nameless draft request.
          name: { type: "string", description: "Customer's full name, if given here" },
          address: { type: "string", description: "Service address, if given here" },
          notes: {
            type: "string",
            description:
              "Extra info for the technician: timings, access/parking, landmarks, 'call before coming'.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_request",
      description:
        "Finalise once name, address and issue are known. Returns the ticket number, or the " +
        "still-missing fields.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_company_info",
      description:
        "Get Oasis Globe facts — services, brands, areas covered, hours, AMC, pricing. Call for a " +
        "general company/services question (NOT about their own ticket). Answer only from what it returns.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "What they're asking about, e.g. 'areas', 'AMC', 'pricing'" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_requests",
      description:
        "List this customer's recent requests with status and technician. Use for a status " +
        "question with no ticket number.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_request_status",
      description:
        "Status, technician and any scheduled visit for a given ticket number. Report only " +
        "what it returns — never invent a date or time.",
      parameters: {
        type: "object",
        properties: {
          ticket_number: { type: "string", description: "e.g. OG-250626-0007" },
        },
        required: ["ticket_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_complaint",
      description:
        "Record a complaint about an EXISTING request (technician did not come, not fixed, " +
        "unhappy) and alert the team. Pass the ticket number if known.",
      parameters: {
        type: "object",
        properties: {
          ticket_number: { type: "string", description: "The request this is about, if known" },
          details: { type: "string", description: "Short summary of the complaint in the customer's words" },
        },
        required: ["details"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_cancellation",
      description:
        "Cancel the customer's existing request. Call ONLY after they clearly confirm cancellation. " +
        "Pass the ticket number (if known) and a short reason.",
      parameters: {
        type: "object",
        properties: {
          ticket_number: { type: "string", description: "The request to cancel, if known" },
          reason: { type: "string", description: "Why they want to cancel" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_reschedule",
      description:
        "Flag that the customer wants a different visit time and alert the team. Pass the ticket " +
        "number (if known) and their preferred time. Do NOT promise a slot.",
      parameters: {
        type: "object",
        properties: {
          ticket_number: { type: "string", description: "The request to reschedule, if known" },
          preferred_time: { type: "string", description: "Preferred time, e.g. 'tomorrow morning', 'after 5pm Saturday'" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "Hand the chat to a human manager. Use when they ask for a person, or are abusive — " +
        "NOT for a complaint about a specific request (use log_complaint).",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Short reason for the handoff" },
        },
        required: ["reason"],
      },
    },
  },
];

// Tools that are pointless to advertise under the current configuration. Sending a
// tool the model must not act on costs tokens on every step AND invites a wasted
// round-trip: with FAQ_ENABLED=false, get_company_info only ever returns "tell them
// the team will confirm", so the model calls it and then has to ask again anyway.
const DISABLED = new Set(env.faqEnabled ? [] : ["get_company_info"]);

// The active tool list. Computed once at import (the flags are env-level, not
// per-request) so there is no per-message filtering cost.
export const ACTIVE_TOOL_DEFS = TOOL_DEFS.filter((t) => !DISABLED.has(t.function.name));

export function getToolDefs() {
  return ACTIVE_TOOL_DEFS;
}
