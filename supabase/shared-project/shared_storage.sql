-- =============================================================================
-- Astra Chat shared project: storage surface (wacrm-* buckets only)
-- Run after wacrm_schema.sql.  Single transaction.
--  * Buckets are PRIVATE (public = false).  Objects are served with signed
--    URLs (createSignedUrl) by the app; see VERIFY.md "App code changes".
--  * ON CONFLICT DO NOTHING: never rewrites a bucket that already exists.
--    A post-check aborts if an existing wacrm-* bucket is public.
--  * Every policy is TO authenticated, scoped by bucket_id AND tenant:
--      chat-media / flow-media : first path segment 'account-<account_id>',
--                                checked with wacrm.is_account_member().
--      avatars                 : first path segment '<user_id>' (app layout);
--                                write = own folder only, read = users who share
--                                an account with the avatar owner.
--  * All policy names start with wacrm_ (no collision with other products).
--  * service_role bypasses RLS (server uploads, inbound media mirror).
-- Bucket size limits and MIME lists are copied from the 058 end state.
-- =============================================================================
BEGIN;
SET LOCAL search_path = wacrm, extensions;

DO $guard$
BEGIN
  IF to_regprocedure('wacrm.is_account_member(uuid, wacrm.account_role_enum)') IS NULL THEN
    RAISE EXCEPTION 'run wacrm_schema.sql first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'wacrm\_%') THEN
    RAISE EXCEPTION 'wacrm_* storage policies already exist; run rollback_wacrm.sql first (nothing was changed)';
  END IF;
END
$guard$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wacrm-avatars', 'wacrm-avatars', false, 2097152, ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wacrm-chat-media', 'wacrm-chat-media', false, 16777216, ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/3gpp',
    'video/3gp',
    'video/quicktime',
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'audio/ogg',
    'audio/mpeg',
    'audio/aac',
    'audio/mp4',
    'audio/amr',
    'audio/opus'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wacrm-flow-media', 'wacrm-flow-media', false, 16777216, ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'video/mp4',
    'video/3gpp',
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'])
ON CONFLICT (id) DO NOTHING;

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('wacrm-avatars','wacrm-flow-media','wacrm-chat-media') AND public) THEN
    RAISE EXCEPTION 'a pre-existing wacrm-* bucket is public; fix it via the Storage API, then rerun';
  END IF;
END
$chk$;

CREATE POLICY wacrm_chat_media_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'wacrm-chat-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END));
CREATE POLICY wacrm_chat_media_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wacrm-chat-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END));
CREATE POLICY wacrm_chat_media_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'wacrm-chat-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END))
  WITH CHECK (bucket_id = 'wacrm-chat-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END));
CREATE POLICY wacrm_chat_media_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'wacrm-chat-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END));

CREATE POLICY wacrm_flow_media_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'wacrm-flow-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END));
CREATE POLICY wacrm_flow_media_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wacrm-flow-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END));
CREATE POLICY wacrm_flow_media_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'wacrm-flow-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END))
  WITH CHECK (bucket_id = 'wacrm-flow-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END));
CREATE POLICY wacrm_flow_media_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'wacrm-flow-media' AND wacrm.is_account_member(
      CASE WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN substr((storage.foldername(name))[1], 9)::uuid END));

CREATE POLICY wacrm_avatars_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'wacrm-avatars' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM wacrm.profiles p
                 WHERE p.user_id::text = (storage.foldername(name))[1]
                   AND wacrm.is_account_member(p.account_id))));
CREATE POLICY wacrm_avatars_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wacrm-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY wacrm_avatars_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'wacrm-avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'wacrm-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY wacrm_avatars_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'wacrm-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMIT;
