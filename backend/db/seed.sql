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
