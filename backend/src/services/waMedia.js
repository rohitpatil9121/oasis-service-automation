/* Keep a copy of every photo a customer sends.

   We only ever stored Meta's media id and fetched the image from Meta each time
   somebody opened the chat. Meta deletes media after about a month, so the
   picture a customer sent of their leaking purifier simply vanished from the
   thread — 328 of the 519 images on record are already gone, and the office
   found out by clicking one and getting "Media not found".

   So the image is copied into our own storage the moment it arrives, and the
   media route serves that copy for ever. The object is named after the media id,
   which means no schema change: wa_inbound keeps storing the id exactly as
   before, and the id is now also the filename.

   Every function here is best-effort. A customer's message must never fail to be
   recorded because a copy could not be taken. */
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

export const WA_MEDIA_BUCKET = "wa-media";

/** The stored copy, or null. `contentType` comes back so the route can serve it. */
export async function readStoredMedia(mediaId) {
  try {
    const { data, error } = await supabase.storage.from(WA_MEDIA_BUCKET).download(String(mediaId));
    if (error || !data) return null;
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || "image/jpeg",
    };
  } catch {
    return null;
  }
}

/* Fetch from Meta.

   Returns the image, or a reason it could not be had. The distinction matters:

     gone      — Meta has deleted it (error subcode 33). Permanent; nothing to
                 retry, and the office should be told the picture is lost.
     transient — usually "(#4) Application request limit reached", Meta's own
                 rate limit, which it marks is_transient. Treating this as gone
                 was a real mistake in the first backfill run: it marched through
                 the list recording perfectly good photographs as deleted.
*/
export async function fetchFromMeta(mediaId) {
  if (env.whatsappMock || env.whatsappProvider !== "meta") return { gone: true };
  try {
    const lookup = await fetch(
      `https://graph.facebook.com/${env.metaGraphVersion}/${mediaId}`,
      { headers: { Authorization: `Bearer ${env.metaAccessToken}` } }
    );
    if (!lookup.ok) {
      const text = await lookup.text().catch(() => "");
      let err = {};
      try { err = JSON.parse(text).error || {}; } catch { /* not JSON */ }
      const transient = err.is_transient === true || err.code === 4 || lookup.status === 429;
      if (!transient) log.error(`media ${mediaId}: Meta lookup ${lookup.status} — ${text.slice(0, 200)}`);
      return transient ? { transient: true, why: err.message || `HTTP ${lookup.status}` } : { gone: true };
    }
    const { url, mime_type } = await lookup.json();
    const bin = await fetch(url, { headers: { Authorization: `Bearer ${env.metaAccessToken}` } });
    if (!bin.ok) return { transient: true, why: `download HTTP ${bin.status}` };
    return {
      buffer: Buffer.from(await bin.arrayBuffer()),
      contentType: mime_type || "image/jpeg",
    };
  } catch (e) {
    // A network blip is not a deleted photo.
    return { transient: true, why: e.message };
  }
}

/** Put a copy in our storage, creating the bucket the first time. */
export async function storeMedia(mediaId, buffer, contentType) {
  try {
    const opts = { contentType, upsert: true };
    let up = await supabase.storage.from(WA_MEDIA_BUCKET).upload(String(mediaId), buffer, opts);
    if (up.error && /bucket|not found/i.test(up.error.message)) {
      // Private: these are customers' own photographs, served only through the
      // authenticated media route — unlike tech-photos, which the app renders
      // from a public URL.
      await supabase.storage.createBucket(WA_MEDIA_BUCKET, { public: false });
      up = await supabase.storage.from(WA_MEDIA_BUCKET).upload(String(mediaId), buffer, opts);
    }
    if (up.error) throw new Error(up.error.message);
    return true;
  } catch (e) {
    log.error(`media ${mediaId}: could not store — ${e.message}`);
    return false;
  }
}

/** Called the moment a photo arrives, so the copy exists before Meta expires it. */
export async function cacheInboundMedia(mediaId) {
  if (!mediaId) return;
  if (await readStoredMedia(mediaId)) return;      // already have it
  const got = await fetchFromMeta(mediaId);
  if (!got?.buffer) return;
  await storeMedia(mediaId, got.buffer, got.contentType);
}
