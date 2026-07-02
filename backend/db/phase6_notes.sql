-- =====================================================================
-- Phase 6 — Request notes: extra info the customer shares on WhatsApp
-- (preferred timings, access instructions, anything beyond the core issue).
-- Visible to the Service Manager on the dashboard AND to the technician in
-- the app. Free text, appended/updated during intake.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

alter table tickets add column if not exists notes text;
