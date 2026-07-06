-- Dashboard board buckets: closed_at for Service Done vs Completed (7-day window),
-- reopened_at so reopened tickets land in Pending (not New).
alter table tickets add column if not exists closed_at timestamptz;
alter table tickets add column if not exists reopened_at timestamptz;

create index if not exists idx_tickets_closed_at on tickets(closed_at);

-- Best-effort backfill from technician close timestamps in tech_work.
update tickets t
set closed_at = (t.tech_work->>'closed_at')::timestamptz
where t.status = 'CLOSED'
  and t.closed_at is null
  and t.tech_work->>'closed_at' is not null;
