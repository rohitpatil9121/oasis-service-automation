-- =====================================================================
-- Phase 2 — Stock moves to per-TECHNICIAN bulk (not per-ticket)
-- A technician takes stock in bulk and reconciles it later (e.g. next day),
-- so a stock issue belongs to a technician and is no longer tied to a ticket.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

alter table stock_issues alter column ticket_id drop not null;
