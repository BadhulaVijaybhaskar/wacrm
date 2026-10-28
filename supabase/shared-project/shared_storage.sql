-- =============================================================================
-- Shared Supabase project — Chat (wacrm) storage surface
--
-- Voice and other products keep their own buckets. Chat buckets are prefixed
-- `wacrm-` so policies can scope to `bucket_id LIKE 'wacrm-%'` without touching
-- unrelated objects.
--
-- Run after `wacrm_schema.sql` on a shared project. Requires storage extension.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wacrm-avatars',
  'wacrm-avatars',
  TRUE,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wacrm-flow-media',
  'wacrm-flow-media',
  TRUE,
  16777216,
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp',
    'video/mp4', 'video/3gpp',
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wacrm-chat-media',
  'wacrm-chat-media',
  TRUE,
  16777216,
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp',
    'image/gif',
    'video/mp4', 'video/3gpp', 'video/3gp', 'video/quicktime',
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr',
    'audio/opus'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Avatars: per-user folder (wacrm-avatars/{uid}/...)
CREATE POLICY wacrm_avatars_select ON storage.objects FOR SELECT
  USING (bucket_id = 'wacrm-avatars');

CREATE POLICY wacrm_avatars_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'wacrm-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY wacrm_avatars_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'wacrm-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY wacrm_avatars_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'wacrm-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Flow media: public read; account- or legacy user-scoped writes
CREATE POLICY wacrm_flow_media_select ON storage.objects FOR SELECT
  USING (bucket_id = 'wacrm-flow-media');

CREATE POLICY wacrm_flow_media_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'wacrm-flow-media'
    AND (
      EXISTS (
        SELECT 1 FROM wacrm.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY wacrm_flow_media_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'wacrm-flow-media'
    AND (
      EXISTS (
        SELECT 1 FROM wacrm.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY wacrm_flow_media_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'wacrm-flow-media'
    AND (
      EXISTS (
        SELECT 1 FROM wacrm.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );

-- Chat media: public read; account-scoped writes
CREATE POLICY wacrm_chat_media_select ON storage.objects FOR SELECT
  USING (bucket_id = 'wacrm-chat-media');

CREATE POLICY wacrm_chat_media_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'wacrm-chat-media'
    AND EXISTS (
      SELECT 1 FROM wacrm.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

CREATE POLICY wacrm_chat_media_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'wacrm-chat-media'
    AND EXISTS (
      SELECT 1 FROM wacrm.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

CREATE POLICY wacrm_chat_media_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'wacrm-chat-media'
    AND EXISTS (
      SELECT 1 FROM wacrm.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
