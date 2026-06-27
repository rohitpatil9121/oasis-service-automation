// Post-close customer rating. When a ticket is CLOSED we send 3 WhatsApp reply
// buttons (services/tickets.js → updateStatus). The customer's tap arrives on the
// webhook as an interactive button_reply whose id we set to `rate_<ticketId>_<n>`.
// This module decodes that id, stores the score, and returns the thank-you reply.
import { recordRating } from "./tickets.js";
import { log } from "../lib/logger.js";

const RATE_RE = /^rate_(.+)_([1-5])$/;

// Decode a rating button id, or null if it isn't one of ours.
export function parseRatingButton(id) {
  const m = RATE_RE.exec(String(id || ""));
  return m ? { ticketId: m[1], rating: Number(m[2]) } : null;
}

// Warm acknowledgement tuned to the score (5 = Excellent, 3 = Okay, 1 = Poor).
const THANKS = {
  5: "Thank you so much! ⭐ We're glad we could help — reach out any time you need us.",
  3: "Thanks for your feedback! 🙏 We'll keep working to serve you even better.",
  1: "We're sorry we fell short. 🙏 Thank you for telling us — our team will look into it.",
};

// Handle an inbound button tap. Returns the reply to send if it was a rating
// button, or null if the id isn't a rating (so the caller falls back to intake).
export async function handleRatingButton(buttonId) {
  const parsed = parseRatingButton(buttonId);
  if (!parsed) return null;
  try {
    await recordRating(parsed.ticketId, parsed.rating);
  } catch (e) {
    // Never surface an error to the customer for a one-tap rating.
    log.error("handleRatingButton:", e.message);
    return "Thanks for your feedback!";
  }
  return THANKS[parsed.rating] || "Thanks for your feedback!";
}
