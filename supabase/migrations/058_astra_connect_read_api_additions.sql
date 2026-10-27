-- ============================================================
-- 058_astra_connect_read_api_additions
--
-- CHAT-04b Connect console follow-ups:
--   - optional takeover `reason` on handoff audit
--   - optional media metadata on messages (filename / size /
--     duration / transcript) for read-API media objects
--
-- Transcript is filled only when already stored — no paid STT.
-- Idempotent. Apply to wacrm-staging by operator.
-- ============================================================

ALTER TABLE astra_connect_handoff_audit
  ADD COLUMN IF NOT EXISTS reason TEXT;

COMMENT ON COLUMN astra_connect_handoff_audit.reason IS
  'Optional free-text reason from Connect takeover (max 500 chars, enforced in app).';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS media_duration_s DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS media_transcript TEXT;

COMMENT ON COLUMN messages.media_filename IS
  'Original or mirrored filename for media_url when known.';
COMMENT ON COLUMN messages.media_size_bytes IS
  'Byte size of media when known (null if never measured).';
COMMENT ON COLUMN messages.media_duration_s IS
  'Media duration in seconds when known (audio/video).';
COMMENT ON COLUMN messages.media_transcript IS
  'Optional voice-note transcript when already available in-app. '
  'Never populated by a paid transcription provider from Chat.';
