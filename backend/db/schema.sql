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
