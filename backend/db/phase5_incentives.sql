-- =====================================================================
-- Phase 5 — Technician Performance Incentives
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
--
-- Incentives are COMPUTED, not stored: the numbers are derived on demand from
-- each closed ticket's tech_work (parts + payments + total) by services/
-- incentives.js. The only schema change is two columns on the parts catalog so
-- every part knows its brand and (for Oasis) its fixed cost.
--
-- Rules (confirmed with the owner):
--   Kent / Aquaguard parts : 6% of the part price, or 10% if the technician's
--                            TOTAL billing for that day crossed 10,000.
--   Oasis parts            : margin = sell price - base_cost (fixed 350).
--                            If the ticket was paid online, 18% GST is cut from
--                            the margin (margin x 0.82).
--   Other / unbranded parts: no incentive.
-- =====================================================================

-- brand drives which rule applies; base_cost is the technician's fixed buy price
-- for margin parts (Oasis). Both are nullable: existing rows stay valid and an
-- unbranded part simply earns no incentive until the owner tags it.
alter table stock_items
  add column if not exists brand     text,
  add column if not exists base_cost numeric not null default 0;

-- keep brand values to the known set (lowercase); null = unbranded / no incentive
alter table stock_items
  drop constraint if exists stock_items_brand_chk;
alter table stock_items
  add constraint stock_items_brand_chk
  check (brand is null or brand in ('kent', 'aquaguard', 'oasis'));

-- ---------- Tag the existing sample parts so the flow is testable now ----------
-- (Owner refines brands/costs from the inventory page later.)
update stock_items set brand = 'oasis', base_cost = 350 where sku = 'RO-SED-10';
update stock_items set brand = 'kent'                     where sku = 'RO-MEM-75';
update stock_items set brand = 'aquaguard'                where sku = 'RO-PUMP';
-- RO-SV left unbranded on purpose: shows an item that earns no incentive.
