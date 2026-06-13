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
