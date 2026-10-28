# Astra Chat app code changes required by shared-sql-v2

These go with the shared-project install. Branch `cursor/astra-connect-adapter-f6ad`.

## Voice review — Connect §15 provisions ledger (do not apply yet)

Additive CREATE-only pack piece for Connect automatic WhatsApp setup:

- `wacrm_connect_provisioned.sql` — creates `wacrm.astra_connect_provisions`
  (idempotency ledger for `whatsapp.connect_provisioned`).
- `rollback_wacrm_connect_provisioned.sql` — drops that table only.

Chat ships the draft flag-gated route
`POST /api/astra-connect/v1/whatsapp/connect-provisioned` behind
`WACRM_CONNECT_PROVISIONED` (default off → 404). **Do not apply this SQL
on the shared project without Voice sign-off.** Run order: after
`wacrm_schema.sql`.

## Voice review — invite-only signup gate (applied; followup not applied)

- `wacrm_signup_invite_gate.sql` — `app_runtime_config`,
  `account_invitations.minted_by_platform_admin`, replaced
  `ensure_chat_profile(p_full_name, p_invite_token_hash)` (atomic
  platform-invite redeem, no personal account; allowlist unchanged;
  label-match removed), idempotent `peek_invitation` /
  `redeem_invitation` for the accepter. **Already applied — do not
  re-edit this file.**
- `rollback_wacrm_signup_invite_gate.sql` — exact inverse. Its
  `redeem_invitation` body matches the live definition from
  `wacrm_schema.sql` bit-for-bit (comments included).

### Followup (do not apply yet)

- `wacrm_invite_gate_followup.sql` — pins `search_path` on
  `tg_account_invitations_platform_mint_guard` (the applied trigger
  function had none).
- `rollback_wacrm_invite_gate_followup.sql` — restores the unpinned
  guard only (leaves invite-gate `redeem_invitation` in place).

### Minting platform invites (Chat app)

Owner/admin console invites (`POST /api/account/invitations`) always
store `minted_by_platform_admin = false` (DB trigger clears the flag
for non-`service_role` inserts). **Those links cannot onboard new
users when `signup_mode=invite`.**

To mint an invite that *does* admit a new user in invite mode, call
the service-role route:

```http
POST /api/platform/invitations
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
# or: Authorization: Bearer <PLATFORM_ADMIN_SECRET>
# or: x-platform-admin-secret: <PLATFORM_ADMIN_SECRET>

{ "account_id": "<uuid>", "role": "agent", "label": "optional", "expiresInDays": 7 }
```

The route inserts via the service client with
`minted_by_platform_admin = true` and returns the plaintext token
once (same shape as the account invitations API). Library:
`src/lib/auth/platform-invite.ts`.

**After apply (and after rollback), reload PostgREST:**

```sql
NOTIFY pgrst, 'reload schema';
```

(The apply SQL already ends with this `NOTIFY`; re-run if the API still
404s the new function signature.) Default `signup_mode` stays `open`.
**Do not apply the followup without Voice sign-off.**

## 1. Private buckets: stop using getPublicUrl (REQUIRED, otherwise media breaks)
All three `wacrm-*` buckets are now `public = false`, so public object URLs return 400/404.
- Store the **storage path**, not a public URL, wherever one is saved today:
  - `upload-media.ts:130` (`uploadAccountMedia` returns `publicUrl`) and its callers: message-composer and node-config-form (flow media)
  - `template-manager.tsx:551` (template header media)
  - `profile-form.tsx:141` (avatars)
  - `mirror-inbound-media.ts:232` (mirrored inbound WhatsApp media)
- **Render time:** resolve the path with `createSignedUrl(path, ttl)` (short TTL, cacheable). Covers use-media-blob-url / blob-cache, message-media, and the header and sidebar avatars.
- **Meta send time:** Meta fetches outbound media by URL. Mint a signed URL server-side (service client) with a TTL long enough for Meta to fetch it (for example 1 h). Covers the flows engine media nodes, broadcasts, and template header handles.
- Existing rows holding public URLs: none on the shared project (fresh install). Staging/dev rows need a path backfill or a URL-to-path fallback in the resolver.

## 2. Invitation peek route runs logged-out
`/api/invitations/` is public in middleware, and the peek route uses `createClient()`, which is anon for logged-out users. `anon` no longer has USAGE on schema wacrm or EXECUTE on `peek_invitation`.
Change the peek route to call `peek_invitation` through `supabaseAdmin()` (service role). The route is server-only and already rate-limited. The redeem route stays on the user client (`authenticated`).

## 3. Configuration
- `STORAGE_BUCKET_PREFIX=wacrm-` and `NEXT_PUBLIC_STORAGE_BUCKET_PREFIX=wacrm-`
- The Supabase clients must use DB schema `wacrm`: `db: { schema: 'wacrm' }` on browser, server and admin clients. `wacrm` must also be added to the project's exposed API schemas (Data API settings), which is a dashboard change.
- Realtime subscriptions: `schema: 'wacrm'` in every `postgres_changes` filter.

## 4. Signup profile creation
There is no trigger on auth.users. The app must call `rpc('ensure_chat_profile', { p_full_name })` after sign-up / first login (the d202a03 behaviour). In v3 `authenticated` has **no INSERT privilege on profiles at all**, so any direct `from('profiles').insert(...)` (for example the ensure-chat-profile fallback) now fails with `permission denied`. Remove it: `ensure_chat_profile` is the only creation path, and invitations go through `redeem_invitation`.

## 5. Owner deletion semantics
`accounts.owner_user_id` is now ON DELETE CASCADE. Deleting an owner's auth user deletes the whole tenant, including teammates' profiles. Any admin "delete user" path must call `transfer_account_ownership` first. See VERIFY.md.

## 6. Service-only RPCs
These are now service_role only. I checked the callers on c678ea9: webhook route (`supabaseAdmin().rpc('bump_conversation_on_inbound')`), auto-reply (`supabaseAdmin`), the v1 broadcasts API (`ctx.supabase` = `supabaseAdmin()`), the flows and automations engines, and webhooks/deliver (db passed in by server-side workers). **No change is expected.** If a user-scoped client ever calls one of these, it gets `permission denied`:
`_bcast_bump`, `recompute_broadcast_counts`, `bump_conversation_on_inbound`, `increment_flow_execution_count`, `increment_automation_execution_count`, `claim_ai_reply_slot`, `record_webhook_failure`, `create_broadcast_with_recipients`.
`merge_duplicate_contacts` and `merge_duplicate_conversations` have no grants (owner only).
