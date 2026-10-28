# PostgREST / API — expose `wacrm` on a shared Supabase project

1. Open the Supabase project **Dashboard** → **Project Settings** → **API**.
2. Under **Exposed schemas** (or **db-schemas** in older dashboards), add `wacrm` alongside `public` (and any Voice schemas). Do **not** remove schemas other products need.
3. Save and wait for the API config to reload (or restart PostgREST if self-hosting).
4. Confirm RPCs resolve: `POST /rest/v1/rpc/ensure_chat_profile` with body `{ "p_full_name": "" }` as an authenticated user.

Client apps should keep using table names without schema prefix; PostgREST routes `wacrm` objects when the schema is exposed.
