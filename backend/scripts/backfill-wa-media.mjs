/* Rescues every customer photo Meta has not yet deleted.

   We stored only Meta's media id and fetched the picture on demand; Meta deletes
   media after about a month, so 328 of the 519 on record were already gone by
   the time anyone noticed. The webhook now keeps a copy of each new one, but
   the images from the last few weeks are still fetchable — for a few more days.
   This grabs them.

   Safe to run repeatedly: anything already stored is skipped.

   Usage, from backend/:
     node --env-file=.env scripts/backfill-wa-media.mjs
*/
import { supabase } from "../src/config/supabase.js";
import { readStoredMedia, fetchFromMeta, storeMedia } from "../src/services/waMedia.js";

const { data, error } = await supabase
  .from("wa_inbound").select("media_id, created_at")
  .not("media_id", "is", null)
  .order("created_at", { ascending: false });
if (error) throw new Error(error.message);

// Newest first: those are the ones Meta still has, and the ones most likely to
// matter to somebody today.
const ids = [...new Set((data || []).map((m) => String(m.media_id)))];
console.log(`${ids.length} distinct media ids on record`);

/* Meta rate-limits this hard — the first run tripped "(#4) Application request
   limit reached" after about 40 images and, because the script could not tell a
   rate limit from a deletion, wrote off everything after that as gone. So: pace
   the requests, and stop entirely after a run of transient failures rather than
   marching through the rest of the list destroying nothing but the truth. */
const GAP_MS = 400;
const STOP_AFTER_TRANSIENT = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let saved = 0, already = 0, gone = 0, transient = 0, run = 0;
for (const [i, id] of ids.entries()) {
  if (await readStoredMedia(id)) { already++; continue; }

  const got = await fetchFromMeta(id);
  if (got?.buffer) {
    if (await storeMedia(id, got.buffer, got.contentType)) saved++;
    run = 0;
  } else if (got?.transient) {
    transient++; run++;
    if (run >= STOP_AFTER_TRANSIENT) {
      console.log(`
stopping: ${run} rate-limited in a row (${got.why}).`);
      console.log("Nothing is lost — run this again in an hour and it picks up where it left off.");
      break;
    }
    await sleep(5000);          // give Meta a moment before the next one
  } else {
    gone++; run = 0;
  }

  if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${ids.length}  saved ${saved}, gone ${gone}, rate-limited ${transient}`);
  await sleep(GAP_MS);
}

console.log(`
rescued now              : ${saved}`);
console.log(`already had              : ${already}`);
console.log(`deleted by Meta, for good: ${gone}`);
console.log(`rate-limited (retryable) : ${transient}`);
