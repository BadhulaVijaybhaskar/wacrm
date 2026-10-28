\set ON_ERROR_STOP 0
\set ON_ERROR_ROLLBACK on
BEGIN;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000b1','b@x'),('00000000-0000-0000-0000-0000000000c1','v@x');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true) \g /dev/null
SELECT wacrm.ensure_chat_profile('B') \g /dev/null
RESET ROLE;
SELECT id AS b FROM wacrm.accounts LIMIT 1 \gset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true) \g /dev/null
\echo == T9 voice-only user self-inserts profile into B account as owner/viewer
INSERT INTO wacrm.profiles(user_id,full_name,email,account_id,account_role) VALUES ('00000000-0000-0000-0000-0000000000c1','C','v@x',:'b','owner');
INSERT INTO wacrm.profiles(user_id,full_name,email,account_id,account_role) VALUES ('00000000-0000-0000-0000-0000000000c1','C','v@x',:'b','viewer');
SELECT 'T9 C sees B account rows' , count(*) FROM wacrm.accounts;
\echo == T10 ensure_chat_profile twice
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true) \g /dev/null
SELECT wacrm.ensure_chat_profile('B2');
SELECT 'T10 B accounts', count(*) FROM wacrm.accounts;
ROLLBACK;
