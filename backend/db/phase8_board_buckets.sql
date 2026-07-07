-- Dashboard board buckets: closed_at for Service Done vs Completed (7-day window),
-- reopened_at so reopened tickets land in Pending (not New).
alter table tickets add column if not exists closed_at timestamptz;
alter table tickets add column if not exists reopened_at timestamptz;

create index if not exists idx_tickets_closed_at on tickets(closed_at);

-- Best-effort backfill from technician timestamps + updated_at for legacy CLOSED rows.
update tickets t
set closed_at = coalesce(
  t.closed_at,
  nullif(t.tech_work->>'closed_at', '')::timestamptz,
  nullif(t.tech_work->>'paid_at', '')::timestamptz,
  nullif(t.tech_work->>'work_done_at', '')::timestamptz,
  t.updated_at
)
where t.status = 'CLOSED'
  and t.closed_at is null;
