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
