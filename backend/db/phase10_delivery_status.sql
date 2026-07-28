-- =====================================================================
-- Phase 10 — WhatsApp delivery status
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
--
-- Until now `notifications.status = SENT` only meant "Meta accepted the API
-- call". It said nothing about whether the message reached the handset, so a
-- silently-undelivered message looked identical to a successful one on the
-- dashboard — which is exactly how the technician OTP problem stayed invisible.
--
-- Meta posts a status webhook for every message (sent → delivered → read, or
-- failed with a reason). These columns record it, so the dashboard can show
-- what actually happened rather than what we hoped happened.
-- =====================================================================

alter table notifications
  -- Meta's own lifecycle value: accepted | sent | delivered | read | failed
  add column if not exists delivery_status text,
  add column if not exists delivered_at    timestamptz,
  add column if not exists read_at         timestamptz,
  -- Populated only on failure: Meta's numeric code + human-readable reason,
  -- e.g. 131026 "Message undeliverable" (recipient can't receive it).
  add column if not exists failure_code    integer,
  add column if not exists failure_detail  text;

-- Status webhooks arrive keyed by the message id we stored as provider_sid, so
-- that lookup has to be fast — it runs on every status callback.
create index if not exists idx_notifications_provider_sid
  on notifications(provider_sid);

-- Handy for "what failed today" queries.
create index if not exists idx_notifications_delivery_status
  on notifications(delivery_status);
