// Post-close customer rating. When a ticket is CLOSED we send a WhatsApp list
// message of 5 star options (services/tickets.js → updateStatus). The customer's
// tap arrives on the webhook as an interactive list_reply (or button_reply) whose
// id we set to `rate_<ticketId>_<n>`. This module decodes that id, stores the
// score, and returns the thank-you reply.
import { recordRating } from "./tickets.js";
import { supabase } from "../config/supabase.js";
import { log } from "../lib/logger.js";

const RATE_RE = /^rate_(.+)_([1-5])$/;

// Decode a rating reply id, or null if it isn't one of ours.
export function parseRatingButton(id) {
  const m = RATE_RE.exec(String(id || ""));
  return m ? { ticketId: m[1], rating: Number(m[2]) } : null;
}

// Warm acknowledgement tuned to the 1–5 score.
function thanksFor(n) {
  if (n >= 4) return "Thank you so much! ⭐ We're glad we could help — reach out any time you need us.";
  if (n === 3) return "Thanks for your feedback! 🙏 We'll keep working to serve you even better.";
  return "We're sorry we fell short. 🙏 Thank you for telling us — our team will look into it.";
}

// Handle an inbound rating tap. Returns the reply to send if it was a rating,
// or null if the id isn't a rating (so the caller falls back to intake).
export async function handleRatingReply(replyId) {
  const parsed = parseRatingButton(replyId);
  if (!parsed) return null;
  try {
    await recordRating(parsed.ticketId, parsed.rating);
  } catch (e) {
    // Never surface an error to the customer for a one-tap rating.
    log.error("handleRatingReply:", e.message);
    return "Thanks for your feedback!";
  }
  return thanksFor(parsed.rating);
}

// A typed "1"–"5" (or "5 star") reply also counts as a rating. Customers outside
// WhatsApp's 24-hour service window get the plain approved template — Meta
// rejects the tap-to-rate list there — so typing the number back is their only
// way to rate. Attributed to their most recent closed ticket that was ASKED for
// a rating and hasn't got one; returns the thank-you reply, or null if this
// message isn't a rating (caller falls through to normal intake).
const TYPED_RATING_RE = /^\s*([1-5])\s*(?:star|stars)?\s*$/i;
const TYPED_RATING_WINDOW_MS = 7 * 24 * 3600 * 1000;

export async function handleTypedRating(phone, text) {
  const m = TYPED_RATING_RE.exec(String(text || ""));
  if (!m) return null;
  const { data: cust } = await supabase
    .from("customers").select("id").eq("phone", phone).maybeSingle();
  if (!cust) return null;
  const { data: t } = await supabase
    .from("tickets").select("id, rating, tech_work")
    .eq("customer_id", cust.id).eq("status", "CLOSED")
    .is("rating", null)
    .not("tech_work->>rating_sent_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!t) return null;
  const askedAt = new Date(t.tech_work?.rating_sent_at || 0).getTime();
  if (Date.now() - askedAt > TYPED_RATING_WINDOW_MS) return null; // stale ask — treat as chat
  const rating = Number(m[1]);
  try {
    await recordRating(t.id, rating);
  } catch (e) {
    log.error("handleTypedRating:", e.message);
    return "Thanks for your feedback!";
  }
  return thanksFor(rating);
}
