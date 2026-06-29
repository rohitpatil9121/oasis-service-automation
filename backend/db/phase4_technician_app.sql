-- =====================================================================
-- Phase 4 — Technician App
-- Powers the field technician PWA (technician-app/). The technician drives a
-- job through its on-site lifecycle; the rich step-by-step data lives in ONE
-- JSONB column so we don't churn the tickets schema. The dashboard keeps using
-- the existing coarse `status` (NEW → ASSIGNED → IN_PROGRESS → CLOSED).
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- All technician-app workflow state for a ticket. Shape (keys optional):
--   tech_status     ACCEPTED | ON_THE_WAY | ARRIVED | DIAGNOSED | ESTIMATE_SENT
--                   | VERIFIED | REJECTED | WORK_DONE | PAID
--   accepted_at, enroute_at, arrived_at, diagnosed_at, estimate_sent_at,
--   approved_at, work_done_at, paid_at        ISO timestamps (proof trail)
--   gps             "lat, lng" captured at arrival
--   issues          string[]   selected issue-type chips
--   tds_in, tds_out pre-repair TDS readings (diagnosis)
--   parts           [{ id, name, price }]
--   photos          { before, damage, oldPart }  (urls / captured flags)
--   note            technician note
--   charge          charge-type id (service | visit | warranty | repeat)
--   approval_channel whatsapp | manager
--   tds_final       post-repair output TDS (work done)
--   proof           { newParts, oldParts }       parts photos at work done
--   payments        [{ method, amount }]
--   total           grand total billed
--   next_service    e.g. "6 months"
--   lead            true when the technician flagged an upsell lead
alter table tickets
  add column if not exists tech_work jsonb not null default '{}'::jsonb;

-- Technician availability toggle shown in the app header.
alter table users
  add column if not exists is_online boolean not null default true;
