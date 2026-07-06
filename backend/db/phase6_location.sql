-- Phase 6 — Live technician location. The technician app streams the device's
-- GPS while logged in; the manager dashboard shows each technician's last-known
-- position. Just three columns on users — the latest fix overwrites the previous.
alter table users
  add column if not exists last_lat    numeric,
  add column if not exists last_lng    numeric,
  add column if not exists location_at timestamptz;
