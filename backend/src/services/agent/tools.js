// Tool registry for the WhatsApp intake agent — Groq / OpenAI function-calling
// format ({ type:"function", function:{ name, description, parameters } }).
// Flow 1 (Inquiry Submission) tools + escalate_to_human. Each description says
// WHEN to call the tool, which improves tool-selection accuracy.
//
// Execution lives in executor.js; the agent loop is in run.js.

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "identify_customer",
      description:
        "Look up the customer who is messaging (by their WhatsApp number) and " +
        "return their saved name, address, and any open service request. Call " +
        "this FIRST in a new conversation so you don't re-ask details we already have.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "save_customer_details",
      description:
        "Save or update the customer's name and/or service address. Call this " +
        "whenever the customer gives their name or address.",
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
        "Start the customer's service request (reuses their existing open request " +
        "if there is one, otherwise creates a new draft). Call this once you begin " +
        "taking a request, before saving the issue.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_request",
      description:
        "Add or update details on the customer's current request. Call this " +
        "whenever the customer describes a symptom, the appliance, or an address. " +
        "If the issue was built up over several messages, pass the full combined issue.",
      parameters: {
        type: "object",
        properties: {
          issue: { type: "string", description: "What is wrong, e.g. 'water leaking', 'low flow', 'not working'" },
          appliance: { type: "string", description: "Purifier brand/model if mentioned, e.g. 'Kent RO'" },
          address: { type: "string", description: "Service address, if given here" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_request",
      description:
        "Finalise the service request once name, address and issue are all known. " +
        "Returns the ticket number on success, or the list of still-missing fields. " +
        "Read the ticket number back to the customer.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_company_info",
      description:
        "Get Oasis Globe company facts — services, brands serviced, areas covered, " +
        "working hours, AMC, pricing. Call this when the customer asks a general " +
        "question about the company or services (NOT about their own ticket). " +
        "Answer only from what it returns; never invent services, areas, or prices.",
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
        "List this customer's recent logged service requests (by their WhatsApp " +
        "number), with status and assigned technician. Use when they ask about " +
        "their request status without giving a ticket number.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_request_status",
      description:
        "Get the status, assigned technician and any scheduled visit for a specific " +
        "ticket number. Use when the customer asks 'what's the status' / 'when will " +
        "he come' and gives a ticket number. Report only what this returns — never " +
        "invent an arrival date or time.",
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
        "Record a complaint about an EXISTING service request — technician didn't " +
        "come, problem not fixed, unhappy with the service — and alert the team. " +
        "Pass the ticket number if known. This also pauses the bot so a human follows up.",
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
        "Cancel the customer's existing service request. Only call this AFTER the " +
        "customer has clearly confirmed they want to cancel. Pass the ticket number " +
        "(if known) and a short reason. The cancellation message is sent automatically.",
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
        "Note that the customer wants to change their visit time, and alert the team " +
        "to confirm a new slot. Pass the ticket number (if known) and their preferred " +
        "time in their own words. Do NOT promise a specific slot — the team confirms it.",
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
        "Hand the conversation to a human manager and pause the bot. Use when the " +
        "customer simply asks to talk to a person, or is abusive — NOT for a service " +
        "complaint about a specific request (use log_complaint for that).",
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
