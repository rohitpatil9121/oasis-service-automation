// AI-powered WhatsApp intake (Groq LLM). Natural conversation that collects
// name, address and issue, then creates a tracked ticket. The customer's
// phone comes from their WhatsApp number, so the agent never has to ask.
//
// Enabled with AI_INTAKE=true (+ GROQ_API_KEY). Falls back to a friendly
// retry message if the LLM is unavailable, and the raw inbound is always
// logged first (in the webhook), so no inquiry is ever lost.
import { supabase } from "../config/supabase.js";
import { getAIResponse } from "./ai.js";
import {
  upsertCustomerByPhone, createDraftTicket, updateTicketIntake, completeIntake,
  getLatestTicketByCustomerPhone, getReusableTicketForCustomer, escalateFollowUp, TICKET_REUSE_DAYS,
} from "./tickets.js";
import { normalizePhone } from "../lib/phone.js";
import { log } from "../lib/logger.js";

const RESET_WORDS = ["restart", "reset", "start over", "cancel"];
const STATUS_WORDS = ["status", "track"];

// A "bare greeting" — the message is ONLY a hello with nothing else. These get
// the fixed opener; any real content (issue, address, complaint) goes to the LLM.
const GREETING_RX =
  /^\s*(hi+|hey+|hello+|helo|hlo|hii+|namaste|namaskar|service|start|menu|good\s+(morning|afternoon|evening))[\s!.,]*$/i;
const MAX_HISTORY = 20; // keep the last N turns sent to the model

// If a customer already has a ticket from the last N days, further messages are a
// FOLLOW-UP about that request — the AI just chats, it does NOT raise a new ticket.
// Shares the single reuse window with the deterministic path (see tickets.js).
const FOLLOW_UP_DAYS = TICKET_REUSE_DAYS;

// First reply when a customer starts a NEW conversation. Fixed (not AI-generated)
// so it goes out reliably every single time, asking for all details at once.
const GREETING =
  "Hi. This is Oasis Globe water purifier service support.\n\n" +
  "Please share:\n" +
  "1. Your name\n" +
  "2. Service issue\n" +
  "3. Service address\n" +
  "4. Picture of your purifier";

// Returning customers (name/address already on file) get a short, personal
// opener instead of re-asking everything.
const welcomeBack = (name) =>
  `Hi${name ? " " + name : ""}. This is Oasis Globe water purifier service support.\n\n` +
  `Please tell us the issue with your purifier.`;

// Appliance (purifier brand/model) capture. When true the agent confirms the
// brand/model is useful if the customer asks, and passively records it whenever
// it's mentioned — it still never forces the question, so intake stays short.
const ASK_APPLIANCE = true;

const AGENT_INTRO =
  `You are a WhatsApp service intake assistant for "Oasis Globe", a water purifier service ` +
  `business in India. You already have the customer's phone number from WhatsApp — never ask for it.\n\n` +
  `STYLE — follow strictly:\n` +
  `- Simple Indian English. Clear, short, practical, operational.\n` +
  `- Do NOT be over-friendly. No fake emotional language.\n` +
  `- Do NOT use emojis.\n` +
  `- Do NOT say "nice to meet you". Do NOT say "sorry to hear" unless the customer reports a ` +
  `serious problem.\n` +
  `- Do NOT over-explain. Prefer 1–4 short lines. No long paragraphs.\n` +
  `- Read what the customer said and respond to it. Do NOT ask for anything already provided. ` +
  `Always move toward creating the request.` +
  (ASK_APPLIANCE
    ? ` If they ask whether you need the purifier type/model, say yes — brand/model helps send ` +
      `the right technician.`
    : ` Do NOT ask for, hint at, or offer to collect the purifier brand/model — only the ` +
      `name, address and issue are needed. If the customer asks whether you need the ` +
      `brand/model, say it is not required.`);


function systemPrompt(collected, returning) {
  if (returning) {
    return `
${AGENT_INTRO}

This is a RETURNING customer — details we have on file:
- name: ${collected.name || "(not on file)"}
- address: ${collected.address || "(not on file)"}
- appliance: ${collected.appliance || "(not on file)"}
- issue so far: ${collected.issue || "(none yet)"}

Do NOT ask for their name or address from scratch. Ask only what issue they are facing today.
If you have the issue but no address change is needed, confirm the saved address in one short
line (e.g. "Use your saved address at ${collected.address || "—"}? Reply Yes, or send a new address.").

EVERY reply MUST be a single JSON object with exactly these two keys: {"fields": { ... }, "message": "..."}

"fields" — include ONLY new or changed details:
- "issue": their problem. IMPORTANT: if there is already an "issue so far" above, ADD any new
  problem they mention to it and return the FULL combined issue — keep the earlier problems too,
  NEVER drop them (e.g. "water leaking; excess water").
- "appliance": which water purifier it is — brand + model (e.g. "Kent RO", "Aquaguard UV"). Capture it ONLY if they mention it; never ask for it.
- "name": ONLY if they say their name has changed.
- "address": ONLY if they give a new/changed address.
- Use {} if nothing new was provided.

"message" — short, operational, no emoji (see STYLE above). Ask for the issue. When you have the
issue and address, say the request is being registered. Do NOT over-explain.

Return ONLY the JSON object. No markdown.

Example — "hi": {"fields":{},"message":"Hi ${collected.name || "there"}. Please tell us the issue with your purifier."}
Example — "yes same, Kent RO not working": {"fields":{"issue":"purifier not working","appliance":"Kent RO"},"message":"Understood. Registering your request now."}
`.trim();
  }

  return `
${AGENT_INTRO}

Collect THREE details: the customer's name, their address (for the technician visit), and the
issue (what's wrong). The appliance — which water purifier it is — is OPTIONAL: capture it only
if the customer mentions it, but never ask for it.

Already collected (do NOT ask for these again):
- name: ${collected.name || "(missing)"}
- address: ${collected.address || "(missing)"}
- issue: ${collected.issue || "(missing)"}
- appliance: ${collected.appliance || "(missing)"}

EVERY reply MUST be a single JSON object with exactly these two keys, in this order:
{"fields": { ... }, "message": "..."}

Building "fields" (the extracted data):
- Pull any name / address / problem / purifier detail the customer mentions into "name" / "address" / "issue" / "appliance".
- "issue" = the symptoms / what's wrong (e.g. "water leaking", "low flow", "not working").
- "appliance" = the water purifier brand + model (e.g. "Kent RO", "Aquaguard UV", "Pureit"). Capture it ONLY if they mention it; never ask for it.
- REQUIRED: whenever the message contains one of these, the matching key MUST appear in "fields". Never leave "fields" empty when the customer gave real details.
- Use "fields": {} only when they gave nothing new (just a greeting or a question).

Building "message":
- Short, operational, no emoji (see STYLE above). Answer any question they asked in one line.
- Then ask only for whichever of name / address / issue is still missing. Do NOT ask for the purifier brand/model.
- When you have the name, address and issue, say their request is being registered.

Return ONLY the JSON object. No markdown, no extra text.

Example — "hi I'm Sunil Kale, my Kent RO is leaking badly, I live at 12 Shivaji Nagar Pune 411005": {"fields":{"name":"Sunil Kale","issue":"RO purifier leaking badly","appliance":"Kent RO","address":"12 Shivaji Nagar, Pune 411005"},"message":"Understood. Registering your request now."}
Example — "my purifier is not working": {"fields":{"issue":"purifier not working"},"message":"Understood. Please share your name and service address for the technician visit."}
Example — "it's an Aquaguard": {"fields":{"appliance":"Aquaguard"},"message":"Noted, Aquaguard. Please share your name and service address for the technician visit."}
`.trim();
}

// System prompt for a customer who ALREADY has a recent ticket. The AI chats
// about that existing request and must NOT create or "log" a new one.
function followUpSystemPrompt(collected, ticket) {
  const tech = ticket.technician?.full_name;
  return `
${AGENT_INTRO}

This customer ALREADY has a service request with us. Do NOT create a new request, do NOT
"log" a ticket, and do NOT ask for their name or address again.

Their request on file:
- Ticket: ${ticket.ticket_number}
- Status: ${ticket.status}${tech ? `\n- Technician: ${tech}` : ""}
- Issue: ${ticket.issue_description || collected.issue || "(on file)"}

Hold a SHORT chat about THIS existing request only (operational tone, no emoji — see STYLE).

EVERY reply MUST be a single JSON object with exactly these two keys, in this order:
{"escalate": true|false, "message": "..."}

Set "escalate" to TRUE only when the customer reports a PROBLEM a human must follow up on: the
technician did not come, it is still not fixed, it stopped working / the problem recurred after
the visit, damage, or they are clearly unhappy. Then "message" = tell them you are forwarding it
to the support team to follow up (do NOT promise a specific time or outcome).

Set "escalate" to FALSE for everything else:
- Status / "when will he come?" → answer from the status above. If a technician is assigned, say
  they will contact the customer before the visit. NEVER invent a time.
- "resolved" / "thank you" → acknowledge briefly and close.
- General chat / a question → answer in one line.

NEVER say "your request is logged" or announce a ticket number as if it is new.
The system AUTOMATICALLY messages the customer when the request is ASSIGNED, SCHEDULED,
COMPLETED or CANCELLED — do NOT repeat or re-announce any of these. Mention status ONLY if
the customer asks. For a simple "ok"/"thanks", reply with ONE short line and no filler.
Return ONLY the JSON object. No markdown.

Example — "technician never came": {"escalate":true,"message":"We are forwarding this to our support team to follow up. They will get back to you."}
Example — "when will he come?": {"escalate":false,"message":"Your request is assigned. The technician will contact you before the visit."}
Example — "thanks, all good now": {"escalate":false,"message":"Glad to hear it. Reach out any time you need us."}
`.trim();
}

// ---------- session persistence (reuses the intake_sessions table) ----------
// data shape for AI mode: { collected: {name,address,issue}, history: [{role,content}] }

async function getActiveSession(phone) {
  const { data } = await supabase
    .from("intake_sessions").select("*")
    .eq("phone", phone).neq("state", "COMPLETED")
    .order("created_at", { ascending: false }).maybeSingle();
  return data;
}

// Look up an existing customer by their WhatsApp number (returning customer).
async function getCustomerByPhone(phone) {
  const { data } = await supabase
    .from("customers").select("full_name, address")
    .eq("phone", phone).maybeSingle();
  return data;
}

// Build the starting session data. For a returning customer we pre-fill their
// name + address so the agent confirms them instead of re-asking; if they say
// something changed, the new value flows through to the customer record on save.
async function buildInitialData(phone) {
  const existing = await getCustomerByPhone(phone);
  if (existing && existing.full_name) {
    const collected = { name: existing.full_name };
    if (existing.address) collected.address = existing.address;
    return { collected, history: [], returning: true };
  }
  return { collected: {}, history: [], returning: false };
}

async function createSession(phone, initialData) {
  const data = initialData || { collected: {}, history: [], returning: false };
  const { data: row, error } = await supabase
    .from("intake_sessions")
    .insert({ phone, state: "AWAITING_NAME", data })
    .select().single();
  if (error) throw new Error("createSession: " + error.message);
  return row;
}

async function saveSession(id, patch) {
  const { error } = await supabase.from("intake_sessions").update(patch).eq("id", id);
  if (error) throw new Error("saveSession: " + error.message);
}

// ---------- function-call parsing ----------

// Combine all problems the customer mentions into one issue string instead of
// overwriting. Handles both model behaviours: if it returns the full enriched
// issue we keep that; if it returns just the new problem we append it.
function mergeIssue(prev, incoming) {
  const a = (prev || "").trim();
  const b = (incoming || "").trim();
  if (!b) return a;
  if (!a) return b;
  const al = a.toLowerCase(), bl = b.toLowerCase();
  if (bl.includes(al)) return b;     // model already combined / enriched
  if (al.includes(bl)) return a;     // nothing new
  return `${a}; ${b}`;               // a genuinely new problem — add it
}

// Merge newly-provided fields from the model's "fields" object into collected.
// name/address/appliance replace; issue accumulates (never drops earlier problems).
function mergeFields(collected, fields) {
  if (!fields || typeof fields !== "object") return;
  for (const key of ["name", "address", "appliance"]) {
    if (typeof fields[key] === "string" && fields[key].trim()) {
      collected[key] = fields[key].trim();
    }
  }
  if (typeof fields.issue === "string" && fields.issue.trim()) {
    collected.issue = mergeIssue(collected.issue, fields.issue);
  }
}

function statusReply(ticket) {
  const lines = [
    `🎫 Your latest request: *${ticket.ticket_number}*`,
    `Status: *${ticket.status}*`,
  ];
  if (ticket.technician) lines.push(`Technician: ${ticket.technician.full_name}`);
  else if (ticket.status === "NEW") lines.push("A technician will be assigned shortly.");
  return lines.join("\n");
}

// ---------- main entry ----------

export async function handleInboundAI({ fromPhone, text }) {
  const phone = normalizePhone(fromPhone);
  const body = (text || "").trim();
  const lower = body.toLowerCase();

  // Global reset.
  if (RESET_WORDS.includes(lower)) {
    const active = await getActiveSession(phone);
    if (active) await saveSession(active.id, { state: "COMPLETED" });
    const initial = await buildInitialData(phone);
    await createSession(phone, initial);
    if (initial.returning) {
      return `🔄 Sure, ${initial.collected.name}! Let's raise a new request. ` +
             `I have your address as *${initial.collected.address || "—"}*. ` +
             `Is your name and address still the same, and what issue are you facing today?`;
    }
    return GREETING;
  }

  let session = await getActiveSession(phone);

  // "status" outside an active intake -> report the latest ticket.
  if (!session && STATUS_WORDS.includes(lower)) {
    const ticket = await getLatestTicketByCustomerPhone(phone);
    if (ticket) return statusReply(ticket);
    return "You don't have any service requests yet.\n\n" + GREETING;
  }

  const isNewConversation = !session;
  if (!session) session = await createSession(phone, await buildInitialData(phone));

  const collected = session.data?.collected || {};
  const history = session.data?.history || [];
  const returning = session.data?.returning || false;

  // ----- Follow-up window (no new ticket) -----
  // If this customer raised a request in the last FOLLOW_UP_DAYS days, treat further
  // messages as a FOLLOW-UP chat about THAT request — never create a second ticket or
  // re-run intake (this also fixes "problem solved" wrongly logging a ticket). Bare
  // greetings still fall through to the normal opener below.
  const bareGreeting = !body || GREETING_RX.test(body);
  if (!bareGreeting) {
    const recentTicket = await getLatestTicketByCustomerPhone(phone);
    // A CANCELLED request is a deliberate end, so a later message is a genuinely
    // new request — fall through to fresh intake (matches getReusableTicketForCustomer).
    const inFollowUp = recentTicket && recentTicket.status !== "CANCELLED" &&
      Date.now() - new Date(recentTicket.created_at).getTime() < FOLLOW_UP_DAYS * 86400000;
    if (inFollowUp) {
      let reply, escalate = false;
      try {
        const parsed = JSON.parse(await getAIResponse([
          { role: "system", content: followUpSystemPrompt(collected, recentTicket) },
          ...history.slice(-MAX_HISTORY),
          { role: "user", content: body },
        ]));
        reply = (parsed.message || "").trim();
        escalate = parsed.escalate === true;
      } catch (e) {
        log.error("follow-up AI error:", e.message);
        reply = "🙏 Thanks for your message — our team will look into it and update you here.";
        escalate = true; // couldn't parse — surface to a human rather than drop it
      }
      if (!reply) reply = "🙏 Noted — our team will get back to you.";
      // Keep the bot's "we'll forward this" promise real: reopen the request and
      // alert the manager(s) instead of just saying it.
      if (escalate) {
        try { await escalateFollowUp({ ticketId: recentTicket.id, customerMessage: body }); }
        catch (e) { log.error("follow-up escalation failed:", e.message); }
      }
      history.push({ role: "user", content: body });
      history.push({ role: "assistant", content: reply });
      await saveSession(session.id, { data: { collected, history, returning } });
      return reply;
    }
  }

  // Create the dashboard request on the very FIRST message so the Service Manager
  // can watch it fill in live as the customer shares details.
  if (!session.ticket_id) {
    try {
      const customer = await upsertCustomerByPhone(phone, { full_name: collected.name, address: collected.address });
      // No duplicate tickets: reuse the customer's existing request — still open,
      // OR raised within the reuse window even if since closed. This is the path
      // a BARE GREETING ("hi") takes (it skips the follow-up branch above), so a
      // plain hello within the window folds onto the recent ticket too. Seed
      // what's already on it so the agent ADDS to the issue rather than starting over.
      const reuse = await getReusableTicketForCustomer(customer.id);
      const ticket = reuse || await createDraftTicket({ customerId: customer.id });
      if (reuse) {
        if (!collected.issue && reuse.issue_description) collected.issue = reuse.issue_description;
        if (!collected.appliance && reuse.appliance) collected.appliance = reuse.appliance;
      }
      session.customer_id = customer.id;
      session.ticket_id = ticket.id;
      await saveSession(session.id, { customer_id: customer.id, ticket_id: ticket.id, data: { collected, history, returning } });
      log.info(`Intake -> ${ticket.ticket_number} for ${phone} (${reuse ? "reused" : "new"})`);
    } catch (e) { log.error("draft attach failed:", e.message); }
  }

  // Brand-new conversation → send the fixed opener ONLY when the first message is
  // just a greeting (hi / hello / namaste). Guarantees a reliable opener without
  // robotically greeting a customer who actually said something — a complaint
  // ("no one came"), an address ("B wing 902"), "problem solved", or a real
  // issue. Anything substantive falls through to the LLM so it reads and replies.
  if (isNewConversation && (!body || GREETING_RX.test(body))) {
    // If they already have a REGISTERED, still-open request, a bare "hi" is a
    // check-in — acknowledge that request instead of re-asking for the issue
    // (which felt like we'd ignored a request that was already assigned).
    const recent = await getLatestTicketByCustomerPhone(phone);
    const hasActiveRequest = recent && recent.intake_complete &&
      recent.status !== "CLOSED" && recent.status !== "CANCELLED";
    const opener = hasActiveRequest
      ? `Hi${collected.name ? " " + collected.name : ""}.\n\n${statusReply(recent)}\n\n` +
        `Need anything else for this request? Just reply here.`
      : returning && collected.name ? welcomeBack(collected.name) : GREETING;
    history.push({ role: "user", content: body });
    history.push({ role: "assistant", content: opener });
    await saveSession(session.id, { data: { collected, history, returning } });
    return opener;
  }

  // Build the model context: fresh system prompt + recent turns + new message.
  const messages = [
    { role: "system", content: systemPrompt(collected, returning) },
    ...history.slice(-MAX_HISTORY),
    { role: "user", content: body },
  ];

  let reply;
  try {
    const raw = await getAIResponse(messages);
    const parsed = JSON.parse(raw);
    reply = (parsed.message || "").trim();

    mergeFields(collected, parsed.fields);
  } catch (e) {
    log.error("AI intake error:", e.message);
    // Don't lose the turn — ask the customer to resend. Inbound is already logged.
    return "Sorry, there was a technical issue. Please send your message again.";
  }

  if (!reply) reply = "Could you tell me a bit more?";

  // Persist the conversation (store readable assistant text, not raw JSON).
  history.push({ role: "user", content: body });
  history.push({ role: "assistant", content: reply });

  // Live-update the request with whatever we have so far (shows on the dashboard).
  try {
    await upsertCustomerByPhone(phone, { full_name: collected.name, address: collected.address });
    if (session.ticket_id) await updateTicketIntake(session.ticket_id, { issue: collected.issue, appliance: collected.appliance });
  } catch (e) { log.error("live intake update failed:", e.message); }

  // Required fields all in → finalise once. Send ONE consolidated message:
  // the AI's conversational reply + confirmation block. completeIntake() no
  // longer sends a customer message, so there's no duplicate.
  const complete = collected.name && collected.address && collected.issue;
  if (complete && session.ticket_id && !session.data?.completed) {
    try {
      const ticket = await completeIntake(session.ticket_id);
      await saveSession(session.id, { state: "COMPLETED", data: { collected, history, returning, completed: true } });
      log.info(`AI intake complete for ${phone} -> ${ticket.ticket_number}`);
      // Send only the canonical confirmation block (spec format). The model's own
      // "registering…" line is dropped so the customer gets one clean message.
      return `${collected.name}, your service request has been logged.\n\n` +
             `Ticket ID: ${ticket.ticket_number}\n` +
             `Service Issue: ${collected.issue}\n` +
             `Address: ${collected.address}\n\n` +
             `We will assign a technician and update you here.`;
    } catch (e) {
      log.error("completeIntake failed:", e.message);
      await saveSession(session.id, { data: { collected, history, returning } });
      return reply;
    }
  }

  await saveSession(session.id, { data: { collected, history, returning } });
  return reply;
}
