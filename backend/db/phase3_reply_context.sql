-- Reply-to (quoted message) support for the dashboard WhatsApp chat.
--
-- To send a native WhatsApp "reply" we need the wamid (WhatsApp message id) of
-- the message being quoted. We already keep the outbound wamid in
-- notifications.provider_sid; we just need the inbound wamid + a small snapshot
-- of whatever message a reply is quoting so the dashboard can render the quote.
--
-- Run this in the Supabase SQL Editor before the reply feature works.

alter table wa_inbound    add column if not exists wa_message_id  text;   -- inbound wamid (Meta msg.id)
alter table wa_inbound    add column if not exists reply_to_wamid text;   -- wamid the customer/technician quoted
alter table notifications add column if not exists reply_to_wamid text;   -- wamid this message quotes
alter table notifications add column if not exists reply_to_body  text;   -- snapshot of the quoted text (for display)
