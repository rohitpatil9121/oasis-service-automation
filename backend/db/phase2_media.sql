-- Inbound WhatsApp media support (images sent by customers / technicians).
-- media_id: Meta numeric media ID, or base64url-encoded Twilio media URL.
-- media_type: MIME type, e.g. image/jpeg.
-- Run once in the Supabase SQL Editor.
alter table wa_inbound add column if not exists media_id text;
alter table wa_inbound add column if not exists media_type text;
