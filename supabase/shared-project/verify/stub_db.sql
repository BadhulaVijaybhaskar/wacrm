CREATE SCHEMA extensions; CREATE SCHEMA auth; CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA extensions, auth, storage TO anon, authenticated, service_role;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
ALTER DATABASE CURRENT_DB SET search_path = "$user", public, extensions;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, owner uuid, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
-- voice-like existing bucket + policy to check non-interference
INSERT INTO storage.buckets(id,name,public) VALUES ('voice-recordings','voice-recordings',false);
CREATE POLICY voice_rec_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id='voice-recordings' AND owner = auth.uid());
CREATE PUBLICATION supabase_realtime;
-- fake pgvector (no server headers on box): float4[] with typmod-less stub
CREATE FUNCTION extensions.vec_cos(float4[], float4[]) RETURNS float8 LANGUAGE sql IMMUTABLE AS $$ SELECT 0::float8 $$;
CREATE OPERATOR extensions.<=> (LEFTARG=float4[], RIGHTARG=float4[], FUNCTION=extensions.vec_cos);
-- v2: also expose the fake pgvector operator in pg_catalog so functions pinned to
-- search_path=public (ref) or wacrm,extensions (pack) both resolve it, without
-- polluting either compared schema.
CREATE FUNCTION pg_catalog.vec_cos_stub(float4[], float4[]) RETURNS float8 LANGUAGE sql IMMUTABLE AS $$ SELECT 0::float8 $$;
CREATE OPERATOR pg_catalog.<=> (LEFTARG=float4[], RIGHTARG=float4[], FUNCTION=pg_catalog.vec_cos_stub);

-- v3: mimic Supabase storage.protect_delete (live: protect_buckets_delete on
-- storage.buckets, protect_objects_delete on storage.objects). Direct DELETEs
-- raise 42501 unless storage.allow_delete_query = 'true'.
CREATE OR REPLACE FUNCTION storage.protect_delete() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END $f$;
CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
