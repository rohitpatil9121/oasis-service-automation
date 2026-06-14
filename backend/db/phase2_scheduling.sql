-- =====================================================================
-- Phase 2 — Visit Scheduling
-- The Service Manager sets (and can change) a visit slot on a ticket.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

alter table tickets add column if not exists scheduled_start timestamptz;
alter table tickets add column if not exists scheduled_end   timestamptz;
