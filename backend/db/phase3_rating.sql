-- Customer service rating (post-close CSAT).
--
-- When a request is CLOSED the customer gets 3 WhatsApp reply buttons
-- (Excellent / Okay / Poor). Their tap is stored here as a 1–5 score
-- (Poor = 1, Okay = 3, Excellent = 5). A `rated` row is also written to
-- ticket_events so it shows in the activity log.
--
-- Run this in the Supabase SQL Editor before the rating feature works.

alter table tickets add column if not exists rating   smallint;
alter table tickets add column if not exists rated_at timestamptz;

-- 1–5 (or NULL when not yet rated).
alter table tickets drop constraint if exists tickets_rating_range;
alter table tickets add  constraint tickets_rating_range
  check (rating is null or rating between 1 and 5);
