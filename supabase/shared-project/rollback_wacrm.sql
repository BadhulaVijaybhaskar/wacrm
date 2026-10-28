-- =============================================================================
-- Astra Chat shared project: remove Chat (wacrm) from the shared project.
--
-- BEFORE running this file: empty the buckets wacrm-avatars, wacrm-flow-media
-- and wacrm-chat-media through the Storage API (dashboard or
-- supabase.storage.from(bucket).remove([...]) / emptyBucket()).  Deleting rows
-- from storage.objects in SQL orphans the underlying files, so this file
-- never does that.  If a bucket still holds objects this file aborts.
--
-- Touches only: schema wacrm, wacrm_* policies on storage.objects, the three
-- wacrm-* buckets, wacrm tables in supabase_realtime (dropped with the
-- tables), cron jobs named wacrm_%.  The vector extension is left installed.
-- Aborts, changing nothing, if any object outside wacrm depends on wacrm.
-- =============================================================================
BEGIN;
SET LOCAL search_path = wacrm, extensions;

DO $pre$
DECLARE
  v_ns oid := (SELECT oid FROM pg_namespace WHERE nspname = 'wacrm');
  v_bad text;
BEGIN
  IF v_ns IS NULL THEN
    RAISE NOTICE 'schema wacrm not present; schema drop will be a no-op';
    RETURN;
  END IF;
  -- Objects NOT in wacrm whose pg_depend rows point at something in wacrm
  -- (views, FKs, functions, policies, triggers, columns of foreign types...).
  WITH wobj AS (
    SELECT 'pg_class'::regclass AS cls, c.oid FROM pg_class c WHERE c.relnamespace = v_ns
    UNION ALL SELECT 'pg_proc'::regclass, p.oid FROM pg_proc p WHERE p.pronamespace = v_ns
    UNION ALL SELECT 'pg_type'::regclass, t.oid FROM pg_type t WHERE t.typnamespace = v_ns
    UNION ALL SELECT 'pg_namespace'::regclass, v_ns
  ), deps AS (
    SELECT DISTINCT d.classid, d.objid, d.objsubid
    FROM pg_depend d
    JOIN wobj w ON w.cls = d.refclassid AND w.oid = d.refobjid
    WHERE d.deptype IN ('n', 'a')
      -- realtime publication membership of wacrm tables is dropped with them
      AND d.classid <> 'pg_publication_rel'::regclass
  ), owned AS (
    -- schema that OWNS each dependent object (sub-objects such as column
    -- defaults, policies, triggers, rules and constraints report no schema
    -- of their own, so resolve them through their table)
    SELECT dp.*, pg_describe_object(dp.classid, dp.objid, dp.objsubid) AS descr,
      CASE dp.classid
        WHEN 'pg_attrdef'::regclass THEN (SELECT c.relnamespace FROM pg_attrdef a JOIN pg_class c ON c.oid = a.adrelid WHERE a.oid = dp.objid)
        WHEN 'pg_policy'::regclass  THEN (SELECT c.relnamespace FROM pg_policy  x JOIN pg_class c ON c.oid = x.polrelid WHERE x.oid = dp.objid)
        WHEN 'pg_trigger'::regclass THEN (SELECT c.relnamespace FROM pg_trigger x JOIN pg_class c ON c.oid = x.tgrelid WHERE x.oid = dp.objid)
        WHEN 'pg_rewrite'::regclass THEN (SELECT c.relnamespace FROM pg_rewrite x JOIN pg_class c ON c.oid = x.ev_class WHERE x.oid = dp.objid)
        WHEN 'pg_constraint'::regclass THEN (SELECT x.connamespace FROM pg_constraint x WHERE x.oid = dp.objid)
        WHEN 'pg_class'::regclass THEN (SELECT x.relnamespace FROM pg_class x WHERE x.oid = dp.objid)
        WHEN 'pg_proc'::regclass  THEN (SELECT x.pronamespace FROM pg_proc x WHERE x.oid = dp.objid)
        WHEN 'pg_type'::regclass  THEN (SELECT x.typnamespace FROM pg_type x WHERE x.oid = dp.objid)
        ELSE NULL   -- anything else (casts, operators, other schemas...) counts as foreign
      END AS owner_ns
    FROM deps dp
  )
  SELECT string_agg(descr, '; ') INTO v_bad
  FROM owned
  WHERE owner_ns IS DISTINCT FROM v_ns
    -- our own storage policies are removed explicitly below
    AND NOT (classid = 'pg_policy'::regclass AND descr LIKE 'policy wacrm\_% on table storage.objects');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'aborting: objects outside wacrm depend on wacrm: %', v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects
             WHERE bucket_id IN ('wacrm-avatars', 'wacrm-flow-media', 'wacrm-chat-media')) THEN
    RAISE EXCEPTION 'aborting: wacrm-* buckets are not empty; empty them via the Storage API first';
  END IF;
END
$pre$;

-- Cron jobs named wacrm_% (none are installed by shared_cron.sql).
DO $cron$
DECLARE r record;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname LIKE ''wacrm\_%''' LOOP
      PERFORM cron.unschedule(r.jobid);
    END LOOP;
  END IF;
END
$cron$;

DROP POLICY IF EXISTS wacrm_avatars_select    ON storage.objects;
DROP POLICY IF EXISTS wacrm_avatars_insert    ON storage.objects;
DROP POLICY IF EXISTS wacrm_avatars_update    ON storage.objects;
DROP POLICY IF EXISTS wacrm_avatars_delete    ON storage.objects;
DROP POLICY IF EXISTS wacrm_flow_media_select ON storage.objects;
DROP POLICY IF EXISTS wacrm_flow_media_insert ON storage.objects;
DROP POLICY IF EXISTS wacrm_flow_media_update ON storage.objects;
DROP POLICY IF EXISTS wacrm_flow_media_delete ON storage.objects;
DROP POLICY IF EXISTS wacrm_chat_media_select ON storage.objects;
DROP POLICY IF EXISTS wacrm_chat_media_insert ON storage.objects;
DROP POLICY IF EXISTS wacrm_chat_media_update ON storage.objects;
DROP POLICY IF EXISTS wacrm_chat_media_delete ON storage.objects;

-- Buckets are empty (checked above), so removing the bucket rows is safe.
DELETE FROM storage.buckets WHERE id IN ('wacrm-avatars', 'wacrm-flow-media', 'wacrm-chat-media');

-- Publication membership of wacrm tables goes away with the tables.
DROP SCHEMA IF EXISTS wacrm CASCADE;

COMMIT;
