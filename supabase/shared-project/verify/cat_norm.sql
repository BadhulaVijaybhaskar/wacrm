\set s :schema
SELECT 'COL '||table_name||'.'||column_name||' '||data_type||' null='||is_nullable||' def='||coalesce(column_default,'') FROM information_schema.columns WHERE table_schema=:'s'
UNION ALL SELECT 'CON '||conrelid::regclass::text||' '||conname||' '||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace=:'s'::regnamespace
UNION ALL SELECT 'IDX '||indexdef FROM pg_indexes WHERE schemaname=:'s'
UNION ALL SELECT 'POL '||tablename||' '||policyname||' '||cmd||' '||roles::text||' U='||coalesce(qual,'')||' C='||coalesce(with_check,'') FROM pg_policies WHERE schemaname=:'s'
UNION ALL SELECT 'TRG '||tgrelid::regclass::text||' '||pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=:'s'::regnamespace AND NOT tgisinternal
UNION ALL SELECT 'FN '||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') secdef='||p.prosecdef||' cfg='||coalesce(array_to_string(p.proconfig,','),'')||' md5='||md5(regexp_replace(regexp_replace(p.prosrc,'\m(public|wacrm)\.','S.','g'),'\s+','','g')) FROM pg_proc p WHERE pronamespace=:'s'::regnamespace
UNION ALL SELECT 'FNACL '||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||coalesce(p.proacl::text,'DEFAULT(PUBLIC)') FROM pg_proc p WHERE pronamespace=:'s'::regnamespace
UNION ALL SELECT 'TACL '||c.relname||' '||coalesce(c.relacl::text,'') ||' rls='||c.relrowsecurity||' ri='||c.relreplident::text FROM pg_class c WHERE relnamespace=:'s'::regnamespace AND relkind='r'
UNION ALL SELECT 'COLACL '||table_name||'.'||column_name||' '||grantee||' '||privilege_type FROM information_schema.column_privileges WHERE table_schema=:'s' AND grantee IN ('anon','authenticated') AND privilege_type<>'SELECT' AND NOT EXISTS (SELECT 1 FROM information_schema.table_privileges tp WHERE tp.table_schema=:'s' AND tp.table_name=column_privileges.table_name AND tp.grantee=column_privileges.grantee AND tp.privilege_type=column_privileges.privilege_type)
UNION ALL SELECT 'TYPE '||typname FROM pg_type WHERE typnamespace=:'s'::regnamespace AND typtype IN ('e','d','c') AND typrelid=0
;
