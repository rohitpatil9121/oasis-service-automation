-- =====================================================================
-- Phase 8 — Purchase price on the parts catalog
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
--
-- purchase_price = what WE paid the supplier for one unit. Distinct from:
--   base_cost  — the lowest price a technician is allowed to charge
--   unit_price — the MRP shown to the customer
-- It's informational for now (stock valuation / margin checks); nothing
-- computes incentives from it.
-- =====================================================================

alter table stock_items
  add column if not exists purchase_price numeric not null default 0;
