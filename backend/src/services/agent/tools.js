

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "identify_customer",
      description:
        "Look up the messaging customer (by WhatsApp number): saved name, address, " +
        "and any open service request. Call FIRST in a new conversation so you don't " +
        "re-ask details we already have.",
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
        "Start the customer's request (reuses their open one if any, else a new draft). " +
        "Call once you begin taking a request, before saving the issue.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_request",
      description:
        "Add/update details on the current request. Call whenever the customer describes a " +
        "symptom, the appliance, an address, or EXTRA info (preferred timings, access/parking, " +
        "landmarks, 'call before coming'). Pass a field's full combined value if built up over messages.",
      parameters: {
        type: "object",
        properties: {
          issue: { type: "string", description: "What is wrong, e.g. 'water leaking', 'low flow', 'not working'" },
          appliance: { type: "string", description: "Purifier brand/model if mentioned, e.g. 'Kent RO'" },
          address: { type: "string", description: "Service address, if given here" },
          notes: {
            type: "string",
            description:
              "Extra info beyond the core issue for the manager/technician — timings ('after 5pm', " +
              "'Sunday only'), access instructions, landmarks, 'call before coming'. Pass full combined notes.",
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
        "Finalise the request once name, address and issue are all known. Returns the ticket " +
        "number on success, or the list of still-missing fields.",
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
        "List this customer's recent requests (by WhatsApp number), with status and technician. " +
        "Use when they ask about their status without a ticket number.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_request_status",
      description:
        "Get status, assigned technician and any scheduled visit for a specific ticket number. " +
        "Use when they ask 'what's the status' / 'when will he come' with a ticket number. " +
        "Report only what it returns — never invent a date or time.",
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
        "Record a complaint about an EXISTING request — technician didn't come, not fixed, unhappy — " +
        "and alert the team. Pass the ticket number if known. Also pauses the bot for human follow-up.",
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
        "Note that the customer wants to change their visit time and alert the team to confirm a new " +
        "slot. Pass the ticket number (if known) and their preferred time in their own words. Do NOT promise a slot.",
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
        "Hand the conversation to a human manager and pause the bot. Use when the customer asks to talk " +
        "to a person, or is abusive — NOT for a complaint about a specific request (use log_complaint).",
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
