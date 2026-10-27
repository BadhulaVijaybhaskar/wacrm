-- ============================================================
-- 054_messaging_channels.sql — WhatsApp / Instagram / Messenger
-- Idempotent. Postgres 17 compatible.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_channel_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_channel_check
      CHECK (channel IN ('whatsapp', 'instagram', 'messenger'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversations_account_channel_idx
  ON conversations (account_id, channel)
  WHERE account_id IS NOT NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_channel_check'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_channel_check
      CHECK (channel IS NULL OR channel IN ('whatsapp', 'instagram', 'messenger'));
  END IF;
END $$;

-- Backfill message channel from parent conversation when null.
UPDATE messages m
SET channel = c.channel
FROM conversations c
WHERE m.conversation_id = c.id
  AND m.channel IS NULL;
