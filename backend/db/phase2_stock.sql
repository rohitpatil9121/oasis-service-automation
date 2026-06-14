-- =====================================================================
-- Phase 2 — Stock (inventory) + Digital Stock Issue + Movement Ledger
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
--
-- Tables:
--   stock_items        master inventory (what we stock + qty on hand)
--   stock_issues       a batch of parts a technician takes for one ticket
--   stock_issue_lines  the per-item rows inside an issue
--   stock_movements    APPEND-ONLY ledger: every inventory movement is logged
-- =====================================================================

-- ---------- Master inventory ----------
create table if not exists stock_items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  sku           text unique,
  unit          text not null default 'pcs',          -- pcs, set, litre…
  qty_on_hand   numeric not null default 0,           -- available in store
  reorder_level numeric not null default 0,           -- low-stock threshold
  unit_price    numeric not null default 0,           -- for costing later
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------- Stock issued to a technician for a ticket (the "register") ----------
create table if not exists stock_issues (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null references tickets(id),
  technician_id  uuid references users(id),
  issued_by      uuid references users(id),            -- the manager who recorded it
  status         text not null default 'ISSUED',       -- ISSUED | RECONCILED | CANCELLED
  issued_at      timestamptz not null default now(),
  reconciled_at  timestamptz
);
create index if not exists idx_stock_issues_ticket on stock_issues(ticket_id);

create table if not exists stock_issue_lines (
  id              uuid primary key default gen_random_uuid(),
  stock_issue_id  uuid not null references stock_issues(id) on delete cascade,
  stock_item_id   uuid not null references stock_items(id),
  qty_issued      numeric not null check (qty_issued > 0),
  qty_used        numeric not null default 0,          -- filled at reconciliation
  qty_returned    numeric not null default 0           -- filled at reconciliation
);
create index if not exists idx_issue_lines_issue on stock_issue_lines(stock_issue_id);

-- ---------- THE LEDGER: every inventory movement ----------
-- qty is SIGNED: positive = into store, negative = out of store.
-- balance_after = stock_items.qty_on_hand right after this movement.
create table if not exists stock_movements (
  id              uuid primary key default gen_random_uuid(),
  stock_item_id   uuid not null references stock_items(id),
  movement_type   text not null check (movement_type in
                    ('RESTOCK','ISSUE','RETURN','CONSUME','VARIANCE','ADJUST')),
  qty             numeric not null,
  balance_after   numeric,
  ticket_id       uuid references tickets(id),
  stock_issue_id  uuid references stock_issues(id),
  actor_id        uuid references users(id),
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_movements_item on stock_movements(stock_item_id);
create index if not exists idx_movements_ticket on stock_movements(ticket_id);

-- ---------- A few sample parts so the stock-issue flow is testable now ----------
-- (Bhushan's inventory page / Excel will refine these later.)
insert into stock_items (name, sku, unit, qty_on_hand, reorder_level, unit_price)
values
  ('RO Sediment Filter',   'RO-SED-10',  'pcs', 50, 10, 180),
  ('RO Membrane 75 GPD',   'RO-MEM-75',  'pcs', 30,  5, 950),
  ('Booster Pump',         'RO-PUMP',    'pcs', 12,  3, 1400),
  ('Solenoid Valve',       'RO-SV',      'pcs', 20,  5, 260)
on conflict (sku) do nothing;
