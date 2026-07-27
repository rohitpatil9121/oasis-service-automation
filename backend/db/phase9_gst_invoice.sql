-- =====================================================================
-- Phase 9 — GST Tax Invoice (Tally-style PDF sent to the customer)
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
--
-- An invoice is issued AFTER payment is collected. Once issued it is FROZEN:
-- the seller/buyer details and line items are snapshotted into the row, so a
-- later edit to the customer record or the parts catalog can never change a
-- bill that has already gone to the customer (and to the books).
--
-- Statutory notes baked into this design:
--   * invoice_no must be a gapless serial per financial year → invoice_counters
--     + next_invoice_seq() allocate it atomically, so two technicians closing a
--     job at the same instant can't collide or skip a number.
--   * CGST/SGST when the place of supply is our own state, IGST otherwise.
--   * The rounded total is stored alongside round_off so the PDF and the books
--     agree to the paisa.
-- =====================================================================

-- ---------- Who we are (single row; fill this in before going live) ----------
create table if not exists company_profile (
  id                 boolean primary key default true check (id),  -- forces one row
  legal_name         text not null default '',
  trade_name         text,
  gstin              text,
  address_line1      text,
  address_line2      text,
  city               text,
  state              text,
  state_code         text,          -- GST state code, e.g. '27' for Maharashtra
  pincode            text,
  phone              text,
  email              text,
  bank_name          text,
  bank_account       text,
  bank_ifsc          text,
  -- UPI id behind the "Scan to pay" QR printed on the invoice. Leave blank and
  -- the QR block is simply omitted rather than printing something unscannable.
  upi_id             text,
  upi_payee_name     text,
  logo_url           text,
  signature_url      text,

  -- Ledger names used by the Tally XML export. These must match the ledgers that
  -- already exist in the Tally company, or the import creates duplicates.
  tally_company_name    text,
  tally_sales_ledger    text default 'Sales',
  tally_cgst_ledger     text default 'CGST',
  tally_sgst_ledger     text default 'SGST',
  tally_igst_ledger     text default 'IGST',
  tally_roundoff_ledger text default 'Round Off',
  -- Part prices in this system are MRP and the technician quotes a final figure,
  -- so amounts are treated as GST-INCLUSIVE and tax is back-calculated. Flip to
  -- false if you ever start quoting pre-tax.
  prices_include_gst boolean not null default true,
  default_gst_rate   numeric not null default 18,
  service_sac        text default '998714',   -- maintenance/repair of household appliances
  invoice_prefix     text not null default 'OG',
  terms              text,
  updated_at         timestamptz not null default now()
);
insert into company_profile (id) values (true) on conflict (id) do nothing;

-- Re-running on an existing install: add the columns introduced after the first
-- version of this file shipped.
alter table company_profile
  add column if not exists upi_id                text,
  add column if not exists upi_payee_name        text,
  add column if not exists tally_company_name    text,
  add column if not exists tally_sales_ledger    text default 'Sales',
  add column if not exists tally_cgst_ledger     text default 'CGST',
  add column if not exists tally_sgst_ledger     text default 'SGST',
  add column if not exists tally_igst_ledger     text default 'IGST',
  add column if not exists tally_roundoff_ledger text default 'Round Off';

-- ---------- Gapless per-FY invoice numbering ----------
create table if not exists invoice_counters (
  fy       text primary key,        -- '25-26'
  last_seq integer not null default 0
);

-- Atomic allocate-and-increment. UPSERT ... RETURNING is a single statement, so
-- concurrent callers serialise on the row lock instead of racing.
create or replace function next_invoice_seq(p_fy text)
returns integer
language plpgsql
as $$
declare v integer;
begin
  insert into invoice_counters (fy, last_seq) values (p_fy, 1)
  on conflict (fy) do update set last_seq = invoice_counters.last_seq + 1
  returning last_seq into v;
  return v;
end;
$$;

-- ---------- The issued invoices ----------
create table if not exists invoices (
  id                 uuid primary key default gen_random_uuid(),
  ticket_id          uuid not null references tickets(id),
  invoice_no         text not null unique,      -- 'OG/25-26/0001'
  fy                 text not null,
  seq                integer not null,
  issued_at          timestamptz not null default now(),

  -- Frozen snapshots — never re-read from the live tables when re-rendering.
  seller             jsonb not null default '{}'::jsonb,
  buyer              jsonb not null default '{}'::jsonb,
  line_items         jsonb not null default '[]'::jsonb,

  place_of_supply    text,
  is_interstate      boolean not null default false,
  prices_include_gst boolean not null default true,

  taxable_value      numeric not null default 0,
  cgst               numeric not null default 0,
  sgst               numeric not null default 0,
  igst               numeric not null default 0,
  round_off          numeric not null default 0,
  total              numeric not null default 0,   -- rounded, payable

  amount_paid        numeric not null default 0,
  payment_mode       text,

  pdf_path           text,      -- object path inside the storage bucket
  pdf_url            text,      -- public URL handed to WhatsApp
  created_at         timestamptz not null default now(),

  unique (fy, seq)
);
create index if not exists idx_invoices_ticket on invoices(ticket_id);
create index if not exists idx_invoices_issued on invoices(issued_at desc);

-- ---------- Tax attributes on the parts catalog ----------
-- Every billed line needs an HSN (goods) or SAC (services) code and its rate.
-- 8421 = filtering/purifying machinery & parts, the usual head for RO spares —
-- confirm per item with your CA and correct from the Inventory page.
alter table stock_items
  add column if not exists hsn_code text,
  add column if not exists gst_rate numeric not null default 18;

update stock_items set hsn_code = '8421' where hsn_code is null;

-- ---------- Place of supply ----------
-- Null = same state as us (the normal case for a local service business), which
-- means CGST + SGST. Set it only for an out-of-state customer.
alter table customers
  add column if not exists state_code text;
