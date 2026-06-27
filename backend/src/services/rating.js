// Post-close customer rating. When a ticket is CLOSED we send a WhatsApp list
// message of 5 star options (services/tickets.js → updateStatus). The customer's
// tap arrives on the webhook as an interactive list_reply (or button_reply) whose
// id we set to `rate_<ticketId>_<n>`. This module decodes that id, stores the
// score, and returns the thank-you reply.
import { recordRating } from "./tickets.js";
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
