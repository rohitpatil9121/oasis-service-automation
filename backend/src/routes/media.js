/* Serves the photos customers and technicians send on WhatsApp.

   Two sources, in this order:

     1. Our own copy in storage. Meta deletes media after roughly a month, so for
        anything older this is the only copy that exists — and for anything newer
        it saves a Graph round trip on every <img> the office scrolls past.
     2. Meta, for a photo that arrived before we started keeping copies. Whatever
        comes back is stored on the way through, so it is asked for only once.

   A photo Meta has already deleted is gone for good: it answers with error
   subcode 33, and no retry will bring it back.
*/
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { readStoredMedia, fetchFromMeta, storeMedia } from "../services/waMedia.js";

const router = Router();

// Media requests accept the JWT as a ?t= query param (browsers can't set headers
// for <img src>), falling back to the Authorization header.
router.use((req, res, next) => {
  const t = req.query.t;
  if (t && t !== "null" && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${t}`;
  }
  requireAuth(req, res, next);
});

/* One place for the response headers. The frontend embeds these via <img src>
   from a different origin, and Helmet's default Cross-Origin-Resource-Policy:
   same-origin makes the browser block the image (curl works — CORP is
   browser-enforced only). */
function sendMedia(res, buffer, contentType) {
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=3600");
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  return res.send(buffer);
}

// GET /api/media/:mediaId
// mediaId: for Meta — the numeric media ID (digits only).
//          for Twilio — base64url-encoded Twilio media URL.
router.get("/:mediaId", async (req, res, next) => {
  try {
    const { mediaId } = req.params;

    const stored = await readStoredMedia(mediaId);
    if (stored) return sendMedia(res, stored.buffer, stored.contentType);

    if (env.whatsappMock) {
      return res.status(404).json({ error: "Media not available in mock mode" });
    }

    if (env.whatsappProvider === "meta") {
      const got = await fetchFromMeta(mediaId);
      if (got?.transient) {
        // Meta's own rate limit, not a missing photo. Saying "not found" here
        // would have the office write off an image that is still there.
        return res.status(503).json({ error: "WhatsApp is rate-limiting us — try again in a minute" });
      }
      if (!got?.buffer) return res.status(404).json({ error: "Media not found" });
      // Keep it, so this is the last time we have to ask Meta for it.
      storeMedia(mediaId, got.buffer, got.contentType).catch(() => {});
      return sendMedia(res, got.buffer, got.contentType);
    }

    // Twilio: mediaId is the Twilio media URL encoded as base64url.
    const twilioUrl = Buffer.from(mediaId, "base64url").toString("utf8");
    const auth = Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString("base64");
    const mediaRes = await fetch(twilioUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!mediaRes.ok) return res.status(404).json({ error: "Media not found" });
    const contentType = mediaRes.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await mediaRes.arrayBuffer());
    storeMedia(mediaId, buffer, contentType).catch(() => {});
    return sendMedia(res, buffer, contentType);
  } catch (e) {
    log.error("media proxy error:", e.message);
    next(e);
  }
});

export default router;
