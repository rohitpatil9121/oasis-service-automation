-- =====================================================================
-- Oasis Globe Phase 1 - COMPLETE one-paste setup
-- Paste this whole file into Supabase Dashboard > SQL Editor > Run.
-- It is idempotent: safe to re-run.
-- =====================================================================

-- =====================================================================
-- Oasis Globe - Service Automation Platform
-- Phase 1 schema: users, customers, tickets, assignments, intake, outbox
-- Target: Supabase / PostgreSQL
-- Run this in the Supabase SQL editor (or via psql) once.
-- =====================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ---------- ENUMS ----------------------------------------------------
do $$ begin
  create type user_role as enum ('owner','manager','technician','customer');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Phase 1 minimum: NEW, ASSIGNED, CLOSED. IN_PROGRESS included for realism.
  create type ticket_status as enum ('NEW','ASSIGNED','IN_PROGRESS','CLOSED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type intake_state as enum
    ('AWAITING_NAME','AWAITING_PHONE','AWAITING_ADDRESS','AWAITING_ISSUE','COMPLETED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_status as enum ('PENDING','SENT','FAILED');
exception when duplicate_object then null; end $$;

-- ---------- STAFF USERS (owner / manager / technician) ---------------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone         text not null unique,          -- E.164 e.g. +918668732890
  email         text unique,
  password_hash text,                          -- bcrypt; null until set
  role          user_role not null default 'technician',
  is_active     boolean not null default true,
  -- OTP login support
  otp_code      text,
  otp_expires_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_users_role on users(role);

-- ---------- CUSTOMERS (people who raise requests on WhatsApp) --------
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text not null unique,            -- E.164
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_customers_phone on customers(phone);

-- ---------- TICKETS --------------------------------------------------
create sequence if not exists ticket_seq start 1001;

create table if not exists tickets (
  id                    uuid primary key default gen_random_uuid(),
  ticket_number         text not null unique
                        default ('OG-' || nextval('ticket_seq')::text),
  customer_id           uuid not null references customers(id) on delete restrict,
  issue_description     text not null,
  status                ticket_status not null default 'NEW',
  assigned_technician_id uuid references users(id) on delete set null,
  source                text not null default 'whatsapp',  -- whatsapp | manual
  created_by            uuid references users(id),          -- staff who created (manual)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_tickets_status on tickets(status);
create index if not exists idx_tickets_customer on tickets(customer_id);
create index if not exists idx_tickets_tech on tickets(assigned_technician_id);

-- ---------- ASSIGNMENTS (history of who was assigned) ----------------
create table if not exists assignments (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references tickets(id) on delete cascade,
  technician_id uuid not null references users(id) on delete restrict,
  assigned_by   uuid references users(id),
  note          text,
  assigned_at   timestamptz not null default now()
);
create index if not exists idx_assignments_ticket on assignments(ticket_id);

-- ---------- TICKET EVENTS (full audit / status + assignment log) -----
create table if not exists ticket_events (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  event_type  text not null,                  -- created | status_changed | assigned | note
  from_status ticket_status,
  to_status   ticket_status,
  actor_id    uuid references users(id),       -- null = system/customer
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_events_ticket on ticket_events(ticket_id);

-- ---------- INTAKE SESSIONS (WhatsApp conversation state) ------------
create table if not exists intake_sessions (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,                  -- WhatsApp sender, E.164
  state       intake_state not null default 'AWAITING_NAME',
  data        jsonb not null default '{}'::jsonb, -- {name,phone,address,issue}
  customer_id uuid references customers(id),
  ticket_id   uuid references tickets(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- only one *active* (non-completed) session per phone
create unique index if not exists uniq_active_intake
  on intake_sessions(phone) where state <> 'COMPLETED';

-- ---------- RAW INBOUND LOG (never lose an inquiry) ------------------
-- Every inbound WhatsApp message is persisted BEFORE any processing, so
-- even if the intake flow errors, the inquiry itself is never lost.
create table if not exists wa_inbound (
  id          uuid primary key default gen_random_uuid(),
  from_phone  text not null,                  -- E.164
  body        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_wa_inbound_phone on wa_inbound(from_phone, created_at desc);

-- ---------- NOTIFICATIONS OUTBOX (queue-ready) -----------------------
create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null default 'whatsapp',
  recipient    text not null,                 -- E.164
  body         text not null,
  status       notification_status not null default 'PENDING',
  related_ticket_id uuid references tickets(id) on delete set null,
  audience     text,                          -- customer | manager | technician
  attempts     int not null default 0,
  last_error   text,
  provider_sid text,                          -- Twilio message SID once sent
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists idx_notifications_status on notifications(status);

-- ---------- updated_at auto-touch trigger ----------------------------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

do $$ begin
  create trigger trg_users_touch    before update on users
    for each row execute function touch_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_customers_touch before update on customers
    for each row execute function touch_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_tickets_touch   before update on tickets
    for each row execute function touch_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_intake_touch    before update on intake_sessions
    for each row execute function touch_updated_at();
exception when duplicate_object then null; end $$;


-- =====================================================================
-- RBAC / Row Level Security groundwork (Phase 1)
-- The backend uses the SERVICE ROLE key and enforces RBAC in middleware,
-- so RLS is enabled-but-permissive here as a foundation for Phase 2,
-- where the frontend may talk to Supabase directly with user JWTs.
-- =====================================================================

alter table users           enable row level security;
alter table customers       enable row level security;
alter table tickets         enable row level security;
alter table assignments     enable row level security;
alter table ticket_events   enable row level security;
alter table intake_sessions enable row level security;
alter table notifications   enable row level security;

-- Service role bypasses RLS automatically. These policies are placeholders
-- documenting the intended Phase 2 access model. Adjust when wiring
-- Supabase Auth + JWT claims (auth.jwt() ->> 'role').

-- Example (commented, enable in Phase 2):
-- create policy "managers read all tickets" on tickets for select
--   using ( (auth.jwt() ->> 'role') in ('owner','manager') );
-- create policy "tech reads own tickets" on tickets for select
--   using ( assigned_technician_id = auth.uid() );


-- =====================================================================
-- Human-readable views for browsing in the Supabase Table Editor.
-- These DO NOT change the underlying tables (the app still uses UUIDs);
-- they just join the IDs to names / ticket numbers so you can read them.
-- Run this once in the Supabase SQL Editor. Safe to re-run.
-- Find them afterwards under Table Editor > Views, or query them in SQL.
-- =====================================================================

-- Tickets, with customer + technician names instead of IDs.
create or replace view tickets_readable as
select
  t.ticket_number,
  c.full_name            as customer,
  c.phone                as customer_phone,
  c.address              as customer_address,
  t.issue_description    as issue,
  t.status,
  tech.full_name         as technician,
  t.source,
  t.created_at,
  t.id                   as ticket_uuid   -- kept at the end if you ever need it
from tickets t
left join customers c    on c.id = t.customer_id
left join users tech     on tech.id = t.assigned_technician_id
order by t.created_at desc;

-- Assignment history, with names instead of IDs.
create or replace view assignments_readable as
select
  t.ticket_number,
  tech.full_name  as technician,
  mgr.full_name   as assigned_by,
  a.note,
  a.assigned_at
from assignments a
left join tickets t   on t.id = a.ticket_id
left join users tech  on tech.id = a.technician_id
left join users mgr   on mgr.id = a.assigned_by
order by a.assigned_at desc;

-- Activity log, with names instead of IDs.
create or replace view ticket_events_readable as
select
  t.ticket_number,
  e.event_type,
  e.from_status,
  e.to_status,
  coalesce(u.full_name, 'system/customer') as actor,
  e.created_at
from ticket_events e
left join tickets t  on t.id = e.ticket_id
left join users u    on u.id = e.actor_id
order by e.created_at desc;


-- =====================================================================
-- Seed data for Phase 1 testing.
-- Passwords are bcrypt hashes of "password123" (CHANGE before production).
-- Generate your own with: node backend/scripts/hash.js <plaintext>
-- =====================================================================

-- Owner
insert into users (full_name, phone, email, role, password_hash)
values ('Oasis Owner', '+918668732890', 'owner@oasisglobe.test', 'owner',
        '$2a$10$sCO57uVDEmIbMTmZfJd2ZeaS/5zwdfv3PV0d/08c/e.0n/HD/rVg.')
on conflict (phone) do nothing;

-- Manager
insert into users (full_name, phone, email, role, password_hash)
values ('Service Manager', '+919000000001', 'manager@oasisglobe.test', 'manager',
        '$2a$10$sCO57uVDEmIbMTmZfJd2ZeaS/5zwdfv3PV0d/08c/e.0n/HD/rVg.')
on conflict (phone) do nothing;

-- Technicians
insert into users (full_name, phone, email, role) values
  ('Tech Ravi',  '+919000000011', 'ravi@oasisglobe.test',  'technician'),
  ('Tech Meena', '+919000000012', 'meena@oasisglobe.test', 'technician'),
  ('Tech Arjun', '+919000000013', 'arjun@oasisglobe.test', 'technician')
on conflict (phone) do nothing;
