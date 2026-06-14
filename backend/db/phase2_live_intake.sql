-- =====================================================================
-- Phase 2 — Live intake: a request appears on the dashboard the moment the
-- customer messages, and fills in as they share details.
--   intake_complete  false while still collecting, true once name+address+issue in
--   appliance        which water purifier (brand/model) the request is about
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

alter table tickets add column if not exists intake_complete boolean not null default true;
alter table tickets add column if not exists appliance text;
