-- =====================================================================
-- Phase 2 — AI bot on/off per customer (manual toggle + auto handoff)
--   ai_paused_until: NULL or in the past  => AI bot is ON (auto-replies)
--                    a future timestamp   => AI bot is OFF (manager handling)
-- Manager sending a manual message auto-pauses 12h; the toggle sets it explicitly.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

alter table customers add column if not exists ai_paused_until timestamptz;
