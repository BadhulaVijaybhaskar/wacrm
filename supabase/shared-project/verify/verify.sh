#!/bin/bash
# Local-only verification (box PG17 harness, unix socket). No remote DBs.
set -u
export PGHOST=/tmp/wacrm-review-pg PGPORT=55439 PGUSER=postgres
W=/workspace/wacrm-staging/v2work; P=/workspace/wacrm-staging/shared-sql-v2; H=/tmp/wacrm-review-pg
DB=v2pack
q(){ psql -X -q -v ON_ERROR_STOP=1 -d $DB "$@"; }
step(){ echo; echo "### $*"; }
step "0. regenerate wacrm_schema.sql from the 058 ref dump"
python3 $W/gen.py $W/ref_public_noacl.sql $P/wacrm_schema.sql
$W/testify.sh $P/wacrm_schema.sql > /tmp/v2_schema_test.sql
step "1. fresh scratch DB $DB with Voice's stubs"
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" 2>&1 | grep -v NOTICE
sed "s/CURRENT_DB/$DB/" $W/stub_db.sql | q >/dev/null && echo "stubs ok"
step "2. clean install"
for f in /tmp/v2_schema_test.sql $P/shared_storage.sql $P/shared_realtime.sql $P/shared_cron.sql; do
  q -f $f >/dev/null 2>/tmp/err.txt; rc=$?; echo "install $(basename $f): exit $rc"; cat /tmp/err.txt; done
step "3. install twice (each file must fail cleanly or no-op)"
for f in /tmp/v2_schema_test.sql $P/shared_storage.sql $P/shared_realtime.sql $P/shared_cron.sql; do
  q -f $f >/dev/null 2>/tmp/err.txt; rc=$?; echo "reinstall $(basename $f): exit $rc :: $(grep -o 'ERROR:.*' /tmp/err.txt)"; done
q -Atc "select 'post-reinstall: tables='||(select count(*) from pg_tables where schemaname='wacrm')||' wacrm_policies='||(select count(*) from pg_policy where polrelid='storage.objects'::regclass and polname like 'wacrm\_%')||' buckets='||(select string_agg(id||':'||public,',' order by id) from storage.buckets)||' pub='||(select count(*) from pg_publication_tables where pubname='supabase_realtime')"
step "4. exploits (exploit.sql from Voice) + extra storage/grant tests"
psql -X -d $DB -f $H/exploit.sql > $W/exploit.out 2>&1
grep -E "^== |ERROR|DELETE|INSERT 0 1$| count|^ T2|^ messages" $W/exploit.out | grep -v "^INSERT 0 1$" ; grep -E "T2 A now|messages in B" -A0 $W/exploit.out
psql -X -d $DB -f $W/exploit_extra.sql > $W/exploit_extra.out 2>&1
grep -E "^== |ERROR|DELETE|INSERT 0 1$|UPDATE|^ S" $W/exploit_extra.out
step "5. catalog diff vs migrated ref (cat.sql, body md5 normalised for schema qualifier)"
PGOPTIONS="-c search_path=public,extensions" psql -XAt -d v2ref -v schema=public -f $W/cat_norm.sql | sed -E -e 's/\bpublic\./wacrm./g' -e "s/search_path=public( |$)/search_path=wacrm, extensions\1/" | sort > $W/ref.cat
PGOPTIONS="-c search_path=wacrm,extensions" psql -XAt -d $DB -v schema=wacrm -f $W/cat_norm.sql | sed -E 's/search_path="?wacrm, extensions"?/search_path=wacrm, extensions/' | sort > $W/pack.cat
diff $W/ref.cat $W/pack.cat > $W/catalog.diff; echo "full diff lines: $(wc -l < $W/catalog.diff)"
strip(){ sed -E -e '/^(FNACL|COLACL) /d' -e 's/^(TACL [a-z_0-9]+) .* (rls=)/\1 \2/' "$1"; }
diff <(strip $W/ref.cat) <(strip $W/pack.cat) > $W/catalog_noacl.diff; echo "--- non-privilege diff:"; cat $W/catalog_noacl.diff
echo "--- ref storage/realtime (public names) vs pack:"
psql -XAt -d v2ref -c "select 'BKT '||id||' public='||public||' lim='||coalesce(file_size_limit,0)||' mimes='||md5(coalesce(allowed_mime_types::text,'')) from storage.buckets where id<>'voice-recordings' order by 1" -c "select 'PUB '||tablename from pg_publication_tables where pubname='supabase_realtime' order by 1" > $W/ref.extra
psql -XAt -d $DB -c "select 'BKT '||replace(id,'wacrm-','')||' public='||public||' lim='||coalesce(file_size_limit,0)||' mimes='||md5(coalesce(allowed_mime_types::text,'')) from storage.buckets where id<>'voice-recordings' order by 1" -c "select 'PUB '||tablename from pg_publication_tables where pubname='supabase_realtime' order by 1" > $W/pack.extra
diff $W/ref.extra $W/pack.extra; echo "(storage/realtime diff exit $?)"
psql -XAt -d $DB -c "select 'OBJPOL '||polname||' roles='||polroles::regrole[]::text from pg_policy where polrelid='storage.objects'::regclass order by 1"
step "6. rollback pre-checks"
q -c "INSERT INTO storage.objects(bucket_id,name) VALUES ('wacrm-chat-media','account-x/a.png')"
q -f $P/rollback_wacrm.sql >/dev/null 2>/tmp/err.txt; rc=$?; echo "rollback with non-empty bucket: exit $rc :: $(grep -o 'ERROR:.*' /tmp/err.txt)"
q -c "DELETE FROM storage.objects WHERE bucket_id='wacrm-chat-media'"   # harness stand-in for Storage API emptying
q -c "CREATE VIEW public.foreign_dep AS SELECT id FROM wacrm.accounts"
q -f $P/rollback_wacrm.sql >/dev/null 2>/tmp/err.txt; rc=$?; echo "rollback with foreign dependent view: exit $rc :: $(grep -o 'ERROR:.*' /tmp/err.txt | cut -c1-200)"
q -Atc "select 'wacrm still present: '||exists(select 1 from pg_namespace where nspname='wacrm')"
q -c "DROP VIEW public.foreign_dep"
q -c "INSERT INTO storage.objects(bucket_id,name) VALUES ('voice-recordings','keep/me.webm')"   # foreign object must survive rollback
step "7. rollback"
q -f $P/rollback_wacrm.sql >/dev/null 2>/tmp/err.txt; rc=$?; echo "rollback: exit $rc"; cat /tmp/err.txt
q -Atc "select 'wacrm left='||exists(select 1 from pg_namespace where nspname='wacrm')" \
   -c "select 'objects policies left='||coalesce(string_agg(polname,','),'') from pg_policy where polrelid='storage.objects'::regclass" \
   -c "select 'buckets left='||coalesce(string_agg(id,','),'') from storage.buckets" \
   -c "select 'voice objects left (expect 1)='||count(*) from storage.objects where bucket_id='voice-recordings'" \
   -c "select 'pub tables left='||count(*) from pg_publication_tables where pubname='supabase_realtime'" \
   -c "select 'uuid-ossp still='||count(*) from pg_extension where extname='uuid-ossp'"
q -f $P/rollback_wacrm.sql >/dev/null 2>/tmp/err.txt; rc=$?; echo "rollback twice: exit $rc $(grep -o 'ERROR:.*' /tmp/err.txt)"
step "8. reinstall after rollback"
for f in /tmp/v2_schema_test.sql $P/shared_storage.sql $P/shared_realtime.sql; do q -f $f >/dev/null 2>/tmp/err.txt; rc=$?; echo "reinstall $(basename $f): exit $rc"; cat /tmp/err.txt; done
step "9. Voice reference DB untouched"
psql -XAt -d ref -c "select 'ref db wacrm tables='||count(*) from pg_tables where schemaname='wacrm'" 2>&1
