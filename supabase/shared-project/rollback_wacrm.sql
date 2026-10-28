-- =============================================================================
-- Roll back Chat (wacrm) from a shared Supabase project
--
-- Does NOT drop Voice or other product schemas. Touches only wacrm + wacrm-*
-- storage buckets and policies.
-- =============================================================================

-- Unschedule Chat cron jobs if any were added manually
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname LIKE 'wacrm_%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
  WHEN invalid_schema_name THEN
    NULL;
END $$;

-- Storage policies (wacrm-* buckets)
DROP POLICY IF EXISTS wacrm_avatars_select ON storage.objects;
DROP POLICY IF EXISTS wacrm_avatars_insert ON storage.objects;
DROP POLICY IF EXISTS wacrm_avatars_update ON storage.objects;
DROP POLICY IF EXISTS wacrm_avatars_delete ON storage.objects;
DROP POLICY IF EXISTS wacrm_flow_media_select ON storage.objects;
DROP POLICY IF EXISTS wacrm_flow_media_insert ON storage.objects;
DROP POLICY IF EXISTS wacrm_flow_media_update ON storage.objects;
DROP POLICY IF EXISTS wacrm_flow_media_delete ON storage.objects;
DROP POLICY IF EXISTS wacrm_chat_media_select ON storage.objects;
DROP POLICY IF EXISTS wacrm_chat_media_insert ON storage.objects;
DROP POLICY IF EXISTS wacrm_chat_media_update ON storage.objects;
DROP POLICY IF EXISTS wacrm_chat_media_delete ON storage.objects;

DELETE FROM storage.objects WHERE bucket_id IN ('wacrm-avatars', 'wacrm-flow-media', 'wacrm-chat-media');
DELETE FROM storage.buckets WHERE id IN ('wacrm-avatars', 'wacrm-flow-media', 'wacrm-chat-media');

-- Realtime publication entries are removed with the schema cascade (table drop).

DROP SCHEMA IF EXISTS wacrm CASCADE;
