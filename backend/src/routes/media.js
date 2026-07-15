// Proxy for WhatsApp media (images sent by customers/technicians).
// Meta media URLs require Bearer auth; Twilio URLs require Basic auth.
// We proxy through here so the frontend never needs provider credentials.
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

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

// GET /api/media/:mediaId
// mediaId: for Meta — the numeric media ID (digits only).
//          for Twilio — base64url-encoded Twilio media URL.
router.get("/:mediaId", async (req, res, next) => {
  try {
    const { mediaId } = req.params;

    if (env.whatsappMock) {
      return res.status(404).json({ error: "Media not available in mock mode" });
    }

    let contentType = "image/jpeg";
    let buffer;

    if (env.whatsappProvider === "meta") {
      // Step 1: resolve the temporary download URL from the Graph API.
      const metaUrlRes = await fetch(
        `https://graph.facebook.com/${env.metaGraphVersion}/${mediaId}`,
        { headers: { Authorization: `Bearer ${env.metaAccessToken}` } }
      );
      if (!metaUrlRes.ok) {
        // Log WHY Meta rejected the id (expired token #190, bad/expired media id
        // #100, permission, etc.) so this doesn't stay a silent broken image.
        const detail = await metaUrlRes.text().catch(() => "");
        log.error(`media ${mediaId}: Meta lookup failed ${metaUrlRes.status} — ${detail.slice(0, 400)}`);
        return res.status(404).json({ error: "Media not found" });
      }
      const { url, mime_type } = await metaUrlRes.json();
      contentType = mime_type || contentType;

      // Step 2: download the binary.
      const mediaRes = await fetch(url, {
        headers: { Authorization: `Bearer ${env.metaAccessToken}` },
      });
      if (!mediaRes.ok) {
        const detail = await mediaRes.text().catch(() => "");
        log.error(`media ${mediaId}: binary download failed ${mediaRes.status} — ${detail.slice(0, 200)}`);
        return res.status(502).json({ error: "Media fetch failed" });
      }
      buffer = Buffer.from(await mediaRes.arrayBuffer());
    } else {
      // Twilio: mediaId is the Twilio media URL encoded as base64url.
      const twilioUrl = Buffer.from(mediaId, "base64url").toString("utf8");
      const auth = Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString("base64");
      const mediaRes = await fetch(twilioUrl, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!mediaRes.ok) return res.status(404).json({ error: "Media not found" });
      contentType = mediaRes.headers.get("content-type") || contentType;
      buffer = Buffer.from(await mediaRes.arrayBuffer());
    }

    // The frontend embeds these via <img src> from a different origin. Helmet's
    // default Cross-Origin-Resource-Policy: same-origin makes the browser block the
    // image (curl works — CORP is browser-enforced only). Allow cross-origin
    // embedding for media responses so the <img> actually renders.
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(buffer);
  } catch (e) {
    log.error("media proxy error:", e.message);
    next(e);
  }
});

export default router;
