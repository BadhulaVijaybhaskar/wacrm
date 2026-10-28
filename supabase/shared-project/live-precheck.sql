-- Astra Chat shared-project LIVE PRE-CHECK  (READ-ONLY)
-- Run before installing anything. Makes no changes: everything runs in a
-- READ ONLY transaction that is rolled back at the end.
-- Expected results are given in each comment; any deviation = STOP.
BEGIN TRANSACTION READ ONLY;

-- 1. server version (expect 17.x)
SELECT 'pg_version' AS check, current_setting('server_version') AS value;

-- 2. extensions: uuid-ossp and pgcrypto must be in "extensions";
--    vector must be absent (the pack creates it WITH SCHEMA extensions)
--    or already in "extensions". Any other schema = STOP.
SELECT 'extension' AS check, e.extname, n.nspname AS schema, e.extversion
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname IN ('uuid-ossp', 'pgcrypto', 'vector', 'pg_cron');
SELECT 'vector_available' AS check, name, default_version, installed_version
FROM pg_available_extensions WHERE name = 'vector';
SELECT 'uuid_generate_v4_in_extensions' AS check,
       to_regprocedure('extensions.uuid_generate_v4()') IS NOT NULL AS ok;  -- expect t

-- 3. realtime publication (expect exists, puballtables = f)
SELECT 'publication' AS check, pubname, puballtables, pubinsert, pubupdate, pubdelete
FROM pg_publication WHERE pubname = 'supabase_realtime';
SELECT 'publication_tables' AS check, schemaname, tablename
FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 2, 3;

-- 4. wacrm schema must NOT exist (expect f)
SELECT 'wacrm_schema_exists' AS check,
       EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'wacrm') AS value;

-- 5. buckets: no wacrm-% bucket may exist (expect 0 rows); list all for context
SELECT 'bucket' AS check, id, name, public FROM storage.buckets ORDER BY id;
SELECT 'wacrm_bucket_collision' AS check, id FROM storage.buckets
WHERE id LIKE 'wacrm-%' OR name LIKE 'wacrm-%';

-- 6. storage.objects policies: none may be named wacrm_% (expect 0 rows)
SELECT 'objects_policy' AS check, policyname, cmd, roles
FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY 2;
SELECT 'objects_policy_collision' AS check, policyname
FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE 'wacrm\_%';

-- 7. triggers on auth.users (informational; the pack adds none)
SELECT 'auth_users_trigger' AS check, tgname, tgenabled
FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;

-- 8. roles the grants rely on (expect 3 rows)
SELECT 'role' AS check, rolname FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role') ORDER BY 2;

-- 9. pg_cron jobs named wacrm_% (expect none; the pack schedules none)
DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    RAISE NOTICE 'wacrm cron jobs: %',
      (SELECT count(*) FROM cron.job WHERE jobname LIKE 'wacrm\_%');
  ELSE RAISE NOTICE 'pg_cron not installed';
  END IF;
END $$;

ROLLBACK;
