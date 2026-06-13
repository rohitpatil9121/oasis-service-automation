-- =====================================================================
-- Migration: ticket number format -> OG-DDMMYY-XXXX
-- e.g. the 1st ticket on 13 Jun 2026 = OG-130626-0001
-- XXXX is a per-day sequence (resets to 0001 each day), date in IST.
-- Run this once in the Supabase SQL Editor. Safe to re-run.
-- Existing tickets keep their old numbers; only new ones use the new format.
-- =====================================================================

-- 1) Stop using the old auto-default (OG-<running number>).
alter table tickets alter column ticket_number drop default;

-- 2) Generate OG-DDMMYY-XXXX on insert.
create or replace function set_ticket_number() returns trigger as $$
declare
  d   text := to_char(now() at time zone 'Asia/Kolkata', 'DDMMYY');
  seq int;
begin
  if new.ticket_number is null or new.ticket_number = '' then
    -- Serialize per-day numbering so two concurrent inserts can't collide.
    perform pg_advisory_xact_lock(hashtext('og_ticket_' || d));

    -- Use the highest existing sequence for today + 1 (NOT count(*), which
    -- collides if a ticket was deleted). split_part extracts the XXXX part.
    select coalesce(max(split_part(ticket_number, '-', 3)::int), 0) + 1 into seq
      from tickets
      where ticket_number like 'OG-' || d || '-%';

    new.ticket_number := 'OG-' || d || '-' || lpad(seq::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ticket_number on tickets;
create trigger trg_ticket_number
  before insert on tickets
  for each row execute function set_ticket_number();
