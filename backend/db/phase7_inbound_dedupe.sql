-- =====================================================================
-- Phase 7 — Inbound idempotency: stop duplicate WhatsApp deliveries from
-- triggering a second bot reply / a duplicate ticket. Meta (and network
-- retries) can deliver the same message id (wamid) more than once. A unique
-- index makes a redelivery fail fast so the webhook can swallow it.
--
-- Partial index (WHERE wa_message_id IS NOT NULL) so older rows and the
-- Twilio path (which has no wamid) are unaffected.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- Step 1: clean up duplicate deliveries that were already stored BEFORE the
-- dedupe code shipped — otherwise the unique index below can't be created.
-- Keep the earliest physical row per wamid, delete the rest. (These are
-- identical redelivered messages; removing the extras only tidies the chat.)
delete from wa_inbound a
using wa_inbound b
where a.wa_message_id = b.wa_message_id
  and a.wa_message_id is not null
  and a.ctid > b.ctid;

-- Step 2: enforce one row per wamid going forward.
create unique index if not exists wa_inbound_wamid_uidx
  on wa_inbound (wa_message_id)
  where wa_message_id is not null;
