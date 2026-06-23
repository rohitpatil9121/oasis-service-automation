-- =====================================================================
-- Phase 3 — Lead source: where a request came from. Oasis Globe serves two
-- streams — leads referred by KENT, and its own service team. The Service
-- Manager picks this when creating a request; it flows into the customer's
-- "request received" WhatsApp template ({{2}}) and shows on the dashboard.
--   lead_source  free text label, e.g. 'KENT' or 'our service team' (nullable;
--                WhatsApp-intake tickets leave it blank)
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

alter table tickets add column if not exists lead_source text;
