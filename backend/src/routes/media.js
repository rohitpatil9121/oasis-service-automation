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
  if (req.query.t && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.t}`;
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
      if (!metaUrlRes.ok) return res.status(404).json({ error: "Media not found" });
      const { url, mime_type } = await metaUrlRes.json();
      contentType = mime_type || contentType;

      // Step 2: download the binary.
      const mediaRes = await fetch(url, {
        headers: { Authorization: `Bearer ${env.metaAccessToken}` },
      });
      if (!mediaRes.ok) return res.status(502).json({ error: "Media fetch failed" });
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

    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  } catch (e) {
    log.error("media proxy error:", e.message);
    next(e);
  }
});

export default router;
