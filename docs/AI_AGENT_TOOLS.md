# Oasis Globe — AI Agent: Conversation Flows & Tool Registry (Groq)

> **Status:** Design + implementation guide for upgrading the WhatsApp assistant
> from a single-prompt extractor to a **Groq tool-calling agent**.
> Audience: engineering. Owner: Rohit. Reviewer: Rahul.
> **Provider: Groq** (kept — no provider switch). Groq's chat API is
> OpenAI-compatible and supports function/tool calling, so we get the tool
> registry Rahul asked for on our existing stack.

---

## 0. TL;DR

Today the WhatsApp assistant is **one Groq LLM call** that reads a message and
returns `{ fields, message }` JSON. All actions (create ticket, assign, send
WhatsApp) run in plain code *after* the model replies — the model never calls
anything itself. There is **no tool registry**.

This document specifies the upgrade:

1. **Identify the conversation flows** the assistant must handle.
2. For each flow, define **what data is needed**.
3. Define a **tool registry** — the functions the model can call itself.
4. Implement it with **Groq function calling** (same provider, `groq-sdk`).

Most tools wrap **service functions that already exist** in the codebase.

---

## 1. Where we are today

| Aspect | Current |
|---|---|
| Provider | **Groq** (`groq-sdk`), model `openai/gpt-oss-120b` ([env.js](../backend/src/config/env.js#L39)) |
| Call shape | Single `chat.completions.create` with `response_format: json_object` ([ai.js](../backend/src/services/ai.js)) |
| Output | `{ "fields": {...}, "message": "..." }` |
| Tools / function calling | ❌ None |
| Where actions happen | Plain code, after the model returns ([aiIntake.js](../backend/src/services/aiIntake.js), [assignment.js](../backend/src/services/assignment.js)) |
| Prompt | `systemPrompt()` in [aiIntake.js](../backend/src/services/aiIntake.js#L69) — an extraction prompt |

**Limitation:** the model can only *extract fields*. It cannot decide to check a
ticket's status, escalate a complaint, cancel a request, or answer an FAQ — each
needs new hand-written branching. A **tool-calling agent** lets the model *choose
the right action*, so one architecture covers every flow.

> Groq supports tool calling natively (OpenAI-compatible `tools` + `tool_calls`),
> so this upgrade is **additive** — same SDK, same provider, no new vendor.

---

## 2. Target architecture

```
WhatsApp ─▶ webhook ─▶ Agent (Groq + tool registry)
                          │  model emits tool_calls
                          ▼
                   tool executor (our code) ─▶ Supabase / WhatsApp
                          │  returns role:"tool" result
                          ▼
                   model composes the reply ─▶ customer
```

- The model receives the message + history + the **tool registry**.
- It either replies directly (FAQ, small talk) or **emits `tool_calls`**.
- **Our code executes** each tool (a thin wrapper over an existing service fn) and
  appends the result as a `role: "tool"` message.
- The model reads the results and **composes the final WhatsApp message**.
- Loop continues until the model returns content with **no `tool_calls`**.

This is the standard OpenAI-style tool loop (see §6).

---

## 3. Conversation flows

The assistant must recognise which flow the customer is in and act accordingly.
`phone` is always known from the WhatsApp context, so the agent never asks for it.

| # | Flow | Customer intent | Data needed | Tools |
|---|---|---|---|---|
| 1 | **Inquiry Submission** | Raise a new service request | name, address, issue, appliance *(optional)* | `identify_customer`, `save_customer_details`, `create_or_get_request`, `update_request`, `submit_request` |
| 2 | **Inquiry Status** | "What's the status?" / "when will he come?" | ticket number *or* phone | `get_my_requests`, `get_request_status` |
| 3 | **General Knowledge (about Oasis)** | Services, areas, timings, AMC, pricing | question topic | `get_company_info` |
| 4 | **Complaint / Follow-up** | Tech didn't come / still broken / unhappy | ticket, complaint text | `get_request_status`, `log_complaint`, `escalate_to_human` |
| 5 | **Reschedule / Cancel** | Change the visit time, or cancel | ticket, reason / preferred time | `request_reschedule`, `request_cancellation` |
| 6 | **Human Handoff** | "Talk to a person" | reason | `escalate_to_human` |

> **Future flow — AMC / filter-change reminder booking:** a customer replies to a
> reminder ("book my filter change"). Reuses `create_or_get_request` +
> `submit_request`; no new tools required.

### Flow detail

**1. Inquiry Submission** — the core flow.
`identify_customer` first (returning customers skip name/address). Collect the
missing pieces conversationally; as each arrives, `update_request` keeps the
dashboard live. When name + address + issue are present, `submit_request`
finalises and returns the ticket number, which the agent reads back.

**2. Inquiry Status** — read-only. Look up by phone (`get_my_requests`) or a
ticket number (`get_request_status`). Report status + assigned technician.
**Never invent a visit time.**

**3. General Knowledge** — answer questions about Oasis Globe from a small curated
knowledge base (`get_company_info`). Factual only; no made-up pricing.

**4. Complaint / Follow-up** — for an existing ticket. `log_complaint` records it
on the ticket timeline; `escalate_to_human` pauses the bot + alerts a manager.
Never promise a specific outcome or time.

**5. Reschedule / Cancel** — `request_reschedule` flags a preferred time for the
manager; `request_cancellation` cancels and sends the cancellation message.

**6. Human Handoff** — `escalate_to_human` is the universal "get me a person"
exit; sets the handoff flag so the AI stays silent while staff replies.

---

## 4. Tool registry

Each tool = one function the model may call. `✅` wraps an **existing** service fn;
`🆕` is a small new function to add.

| Tool | Purpose | Parameters (data) | Backed by |
|---|---|---|---|
| `identify_customer` | Look up caller by phone → name/address/open tickets | *(none — phone from context)* | `upsertCustomerByPhone` + lookup ✅ |
| `save_customer_details` | Save/update name + address | `{ name, address }` | `upsertCustomerByPhone` ✅ |
| `create_or_get_request` | Reuse open ticket or create a draft | *(none)* | `getOpenTicketForCustomer`, `createDraftTicket` ✅ |
| `update_request` | Fill issue / appliance / address | `{ issue?, appliance?, address? }` | `updateTicketIntake` ✅ |
| `submit_request` | Finalise → returns ticket number | *(none)* | `completeIntake` ✅ |
| `get_my_requests` | List this customer's tickets | *(none)* | new query 🆕 |
| `get_request_status` | Status + technician + schedule of a ticket | `{ ticket_number }` | `getTicket` ✅ |
| `get_company_info` | FAQ: services, areas, timings, AMC, pricing | `{ topic }` | knowledge base 🆕 |
| `log_complaint` | Record a complaint on a ticket | `{ ticket_number, details }` | `ticket_events` insert 🆕 |
| `request_reschedule` | Ask to change visit time | `{ ticket_number, preferred_time }` | schedule fields + manager alert 🆕 |
| `request_cancellation` | Cancel a request | `{ ticket_number, reason }` | status→CANCELLED + `requestCancelledCustomer` ✅ |
| `escalate_to_human` | Pause AI, alert manager (handoff) | `{ reason }` | handoff flag + `queueNotification` ✅ |

### Example tool schemas (Groq / OpenAI function-calling format)

```js
// backend/src/services/agent/tools.js
export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "identify_customer",
      description:
        "Look up the customer who is messaging (by their WhatsApp number) and " +
        "return their saved name, address, and any open service request. " +
        "Call this FIRST in every new conversation so you don't re-ask known details.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_request",
      description:
        "Add or update details on the customer's current service request. " +
        "Call this whenever the customer gives a new symptom, appliance, or address.",
      parameters: {
        type: "object",
        properties: {
          issue:     { type: "string", description: "What's wrong, e.g. 'water leaking'" },
          appliance: { type: "string", description: "Purifier brand/model, e.g. 'Kent RO'" },
          address:   { type: "string", description: "Service address for the visit" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_request",
      description:
        "Finalise the service request once name, address, and issue are all known. " +
        "Returns the ticket number to read back to the customer.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_request_status",
      description:
        "Get the current status, assigned technician, and schedule of a ticket. " +
        "Use when the customer asks 'what's the status' or 'when will he come'. " +
        "Never invent a visit time — report only what this returns.",
      parameters: {
        type: "object",
        properties: { ticket_number: { type: "string" } },
        required: ["ticket_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "Hand the conversation to a human manager and pause the AI. Use for " +
        "complaints, anger, repeated problems, or when the customer asks for a person.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  },
  // ... remaining tools follow the same shape
];
```

> **Tip:** make each `description` say *when* to call the tool, not just what it
> does — it raises the rate of correct tool selection.

---

## 5. System prompt (router)

Sets persona + style and tells the model the flows exist. It does **not** hard-code
logic — the tools do the work. Passed as the first `{ role: "system" }` message.

```text
You are the WhatsApp assistant for Oasis Globe, a water-purifier service company
in Pune. You help customers over WhatsApp in a short, polite, operational tone
(Hindi/English/Marathi as the customer uses). No long paragraphs, minimal emoji.

You can handle these things by calling tools:
- Register a new service request (collect name, address, and the issue).
- Tell a customer the status of an existing request.
- Answer questions about Oasis Globe (services, areas served, timings, AMC).
- Take complaints and hand off to a human when needed.
- Help cancel or reschedule a visit.

Rules:
- Always call identify_customer at the start so you don't re-ask known details.
- Phone number is already known — never ask for it.
- Never invent a technician's arrival time or a price. If you don't know, say so
  or use get_company_info / get_request_status.
- For complaints, anger, or "talk to a person" → escalate_to_human.
- Keep each reply to what the customer needs next.
```

Per-customer context (name, open ticket) is injected as an extra `system` line in
the message list, not baked into the static prompt.

---

## 6. The agent loop (Groq function calling)

```js
// backend/src/services/agent/run.js
import Groq from "groq-sdk";
import { env } from "../../config/env.js";
import { TOOL_DEFS } from "./tools.js";
import { executeTool } from "./executor.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const client = new Groq({ apiKey: env.groqApiKey });
const MAX_STEPS = 6; // safety cap on tool round-trips

export async function runAgent({ phone, history, userText }) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.chat.completions.create({
      model: env.groqModel,      // e.g. "openai/gpt-oss-120b" (must support tools)
      messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 1024,
    });

    const msg = res.choices[0].message;
    messages.push(msg); // keep the assistant turn (may carry tool_calls)

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: msg.content || "", messages }; // final answer
    }

    // Execute every tool the model asked for, append results.
    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
      const result = await executeTool(call.function.name, args, { phone });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Hit the step cap — fail safe to a human.
  await executeTool("escalate_to_human", { reason: "agent step limit" }, { phone });
  return { reply: "Let me connect you with our team — they'll reply here shortly.", messages };
}
```

`executeTool` is a switch that maps each tool name to the existing service fn and
returns a small JSON result (e.g. `{ ticket_number: "OG-230626-0007", status: "ASSIGNED" }`).

```js
// backend/src/services/agent/executor.js  (sketch)
export async function executeTool(name, args, ctx) {
  switch (name) {
    case "identify_customer":     return identifyCustomer(ctx.phone);
    case "save_customer_details": return saveCustomer(ctx.phone, args);
    case "create_or_get_request": return createOrGetRequest(ctx.phone);
    case "update_request":        return updateRequest(ctx.phone, args);
    case "submit_request":        return submitRequest(ctx.phone);          // -> completeIntake
    case "get_my_requests":       return getMyRequests(ctx.phone);
    case "get_request_status":    return getRequestStatus(args.ticket_number);
    case "get_company_info":      return getCompanyInfo(args.topic);
    case "log_complaint":         return logComplaint(args);
    case "request_reschedule":    return requestReschedule(args);
    case "request_cancellation":  return requestCancellation(args);
    case "escalate_to_human":     return escalateToHuman(ctx.phone, args.reason);
    default: return { error: `unknown tool: ${name}` };
  }
}
```

---

## 7. Implementation plan (additive — no provider change)

| File | Change |
|---|---|
| `backend/package.json` | No change — `groq-sdk` already present |
| `backend/.env` | `GROQ_API_KEY` (already used by AI intake) |
| **New** `backend/src/services/agent/` | `tools.js` (registry), `prompt.js`, `executor.js`, `run.js` |
| `backend/src/services/aiIntake.js` | The "complete → confirmation" logic moves into the `submit_request` tool; manual JSON parsing of `{fields,message}` goes away |
| `backend/src/routes/webhook.js` | Call `runAgent(...)` instead of `handleInboundAI(...)` |

**Model note:** `tool_choice: "auto"` requires a Groq model that supports function
calling. Confirm the configured `GROQ_MODEL` supports tools (e.g.
`openai/gpt-oss-120b` or `llama-3.3-70b-versatile`); set `GROQ_MODEL` accordingly.

**Rollout:** gate behind a flag (e.g. `AGENT_MODE=tools` vs the current `AI_INTAKE`
path), test in `WHATSAPP_MOCK=true`, then cut over.

---

## 8. Open questions for Rahul

1. **Knowledge base** for `get_company_info` — static config file, or a DB table
   the owner can edit?
2. **Reschedule** — let customers pick a slot, or just flag a preferred time for
   the manager to confirm? (affects `request_reschedule`)
3. **Guardrails** — which tools (if any) need manager approval before they run
   (e.g. `request_cancellation`)?
4. **Model** — keep `openai/gpt-oss-120b`, or move to a Groq model tuned for tool
   use? (verify tool-calling reliability on the chosen model)

---

## 9. Build order (suggested)

1. Scaffold `agent/` (`tools.js`, `prompt.js`, `executor.js`, `run.js`).
2. Implement **Flow 1 (Inquiry Submission)** end-to-end as the proof of concept.
3. Add **Flow 2 (Status)** + **Flow 3 (FAQ)**.
4. Add **Flows 4–6** (complaint, reschedule/cancel, handoff).
5. Flag-gate, test in mock mode, cut over from the current intake path.
```
