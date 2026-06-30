-- Push notifications (technician app): store each technician's FCM device token.
-- One token per user is enough for this use case; re-registering overwrites it.
alter table users add column if not exists push_token text;
