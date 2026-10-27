# CHAT-15 — UI control audit (Golden Rule)

**Scope:** codebase crawl of existing product screens (no live app / auth DB).  
**Rule:** every selectable UI control must work end-to-end, or be hidden/removed.  
**Date:** 2026-10-27  
**Method:** static analysis of handlers (`onClick` / `onSubmit` / `fetch` / Supabase / router), stub markers (`TODO`, empty handlers, feature-flag scaffolding), and related unit tests.

### Classification

| Label | Meaning |
| --- | --- |
| **working** | Handler performs a real state update, API/route call, navigation, or persistence |
| **dead** | Visible and selectable but no-op, stub, broken E2E path, or toast-only without work |
| **hide-candidate** | Incomplete / unsupported feature still exposed as a control; remove or hide |

### Executive findings (fix first)

1. **DEAD (E2E):** Forgot-password sends a Supabase reset email whose `redirectTo` points at `/auth/callback?next=/reset-password`, but **neither route exists** in `src/app/`. The form “works” (email API), the recovery link does not.
2. **HIDE-CANDIDATE:** Template create/edit category **Authentication** is selectable; submit is hard-disabled + early-return. Prefer removing the option (sync-from-Meta already covers Auth templates).
3. **GAP (no visible dead control):** Ownership transfer API + `canTransferOwnership` exist; **no Settings UI** — owners cannot transfer from the product (comment: “lands later”).
4. No widespread `onClick={() => {}}` / “coming soon” stubs found in product UI. Most surfaces are wired.

---

## 1. Auth

### 1.1 Login — `src/app/(auth)/login/page.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Email / password inputs | working | Controlled state → `handleLogin` | — (no page test) |
| Sign in submit | working | `supabase.auth.signInWithPassword` then `window.location.href` to `/dashboard` or `/join/...` (L45–72) | — |
| Forgot password link | working | `<Link href="/forgot-password">` (L118–123) | — |
| Create account link | working | `<Link href="/signup">` (+ invite query) (L143–152) | — |

### 1.2 Signup — `src/app/(auth)/signup/page.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Form fields + submit | working | `supabase.auth.signUp` with optional `emailRedirectTo` for invites (L49–92) | — |
| Back to sign in | working | `<Link href="/login">` (L113–121, L216–225) | — |

### 1.3 Forgot password — `src/app/(auth)/forgot-password/page.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Email + Send link | **dead (E2E)** | Calls `resetPasswordForEmail` with `redirectTo: .../auth/callback?next=/reset-password` (L32–33). **No** `src/app/auth/callback` and **no** `reset-password` page anywhere in the repo. Email may send; clicking the link 404s / never completes reset. | — |
| Back to sign in | working | `<Link href="/login">` | — |

**Fix direction:** add `/auth/callback` (exchange code/session) + `/reset-password` (update password), or change `redirectTo` to a route that exists.

---

## 2. Dashboard shell / sidebar / header

### 2.1 Shell — `src/app/(dashboard)/dashboard-shell.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Auth gate + redirect | working | `useAuth` → `router.push('/login')` when unauthenticated (L40–44) | — |
| Mobile sidebar open | working | `Header onOpenSidebar` → `setSidebarOpen(true)` (L69) | — |

### 2.2 Sidebar — `src/components/layout/sidebar.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Primary nav links (dashboard, inbox, notifications, contacts, pipelines, broadcasts, automations, flows, agents) | working | Next `<Link href=...>` (L83–93, L208) | `src/components/layout/sidebar-state.test.ts` (collapse logic only) |
| Settings link | working | `bottomNavItems` → `/settings` | same |
| Collapse / expand / mobile close | working | `toggleCollapsed` + `localStorage` `astra.v2.sidebar` (L172–187); backdrop `onClose` (L259–262) | `sidebar-state.test.ts` |
| Brand → dashboard | working | `<Link href="/dashboard">` (L289–290) | — |
| User menu: Profile / Settings / Legal | working | Links to `?tab=profile`, `?tab=whatsapp`, `/legal` (L421–456) | — |
| Sign out | working | `onClick={signOut}` from `useAuth` (L458–459) | — |
| Flows “Beta” badge | working (label only) | Non-interactive badge (L218–224); flows themselves are soft-GA | — |

### 2.3 Header — `src/components/layout/header.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Hamburger (mobile) | working | `onOpenSidebar` (L58–64) | — |
| Mode toggle | working | `ModeToggle` → `useTheme().toggleMode` (`mode-toggle.tsx` L27) | — |
| Account menu Profile / Settings / Sign out | working | Links + `signOut` (L116–145) | — |
| Page title | note | `pageTitles` omits `/flows` and `/agents` → falls back to `"dashboard"` (L17–33). Display bug, not a dead control. | — |

---

## 3. Inbox / threads

**Files:** `src/app/(dashboard)/inbox/page.tsx`, `components/inbox/*`

### 3.1 Conversation list — `conversation-list.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Search | working | Filters local list via `search` state (L231–236) | `src/lib/inbox/conversations.test.ts` (filter helpers) |
| Status / unread filter dropdown | working | `setFilter` (L250–252); options L58–64 | same |
| Tag multi-filter | working | `toggleTag` + checkbox items (L288–292) | `matchesContactFilters` tests |
| Company filter | working | `setSelectedCompany` (L325–340) | same |
| Clear chips / clear all | working | L360–387 | same |
| Select conversation | working | `onSelect(conv)` → parent sets active + URL `?c=` | — |

### 3.2 Message thread header — `message-thread.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Back (mobile) | working | `onBack` (L932–940) | — |
| Contact panel toggle | working | `onToggleContactPanel` + parent `localStorage` (`inbox/page.tsx` L81–90) | — |
| Refresh | working | `handleRefreshClick` / parent `resyncToken` (L998–1012) | — |
| Status dropdown | working | `handleStatusChange` → `PATCH /api/conversations/[id]/status` with Supabase fallback (L643–674, L1031) | related: `lib/conversations/reopen.test.ts` |
| Assign / Unassign | working | `handleAssignChange` → `conversations.assigned_agent_id` update (L865–882, L1067, L1095) | — |

### 3.3 Composer — `message-composer.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Send text | working | `onSend` → parent `/api/whatsapp/send` | `src/app/api/whatsapp/send/route.test.ts`, `lib/whatsapp/send-message.test.ts` |
| Attach image/video/document | working | Upload via `uploadAccountMedia` then `onSendMedia` | `lib/storage/upload-media.test.ts` |
| Voice record | working | opus-recorder → upload → send | — |
| Interactive builder | working | Dialog → `onSendInteractive` → send API | `lib/whatsapp/interactive.test.ts` |
| Quick reply picker | working | `GET /api/quick-replies` + insert text/payload | — |
| Templates button | working | `onOpenTemplates` → `TemplatePicker` | — |
| AI draft | working | `POST /api/ai/draft` (L264+) | `lib/ai/*` tests |
| Save as quick reply | working | `POST /api/quick-replies` (L335+) | — |
| Viewer / session-expired gates | working | `GatedButton` / `disabled` when `!canSend` or `sessionExpired` (intentional) | — |

### 3.4 Message actions / media

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| React emoji | working | `POST /api/whatsapp/react` (`message-thread.tsx` ~L847) | — |
| Reply | working | Sets reply draft → composer | — |
| Copy | working | `navigator.clipboard` (`message-actions.tsx` L53–66) | — |
| Media open / download / lightbox | working | Blob download + zoom/nav (`message-media.tsx`, `media-lightbox.tsx`) | `lib/media/*` tests |

### 3.5 AI thread banner — `ai-thread-banner.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Take over / Resume AI | working | `POST /api/ai/autoreply/[conversationId]` (L104–109) | `lib/ai/auto-reply.test.ts`, `lib/ai/handoff.test.ts` |

### 3.6 Contact sidebar — `contact-sidebar.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Copy phone/handle | working | clipboard (L84–95, L164–165) | — |
| Add note | working | insert `contact_notes` (L97–124, L278–285) | — |
| Tags / deals display | working (read-only) | Non-buttons; display only. Edit lives in Contacts / Pipelines. | — |

### 3.7 Template picker (inbox)

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Pick + fill vars + send | working | Loads approved templates; `onSend` → thread send path | `lib/whatsapp/template-*.test.ts` |

---

## 4. Contacts — `src/app/(dashboard)/contacts/page.tsx` + `components/contacts/*`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Search / tag filter / pagination | working | Client filter + page state | `lib/contacts/parse-contact-csv.test.ts`, `dedupe.test.ts` |
| Add contact | working | `ContactForm` → Supabase insert | same |
| Import CSV | working | `ImportModal` parse + insert | `parse-contact-csv.test.ts` |
| Custom fields manager (admin) | working | Opens dialog; CRUD via settings component | — |
| Row select / bulk delete | working | Gated delete of selected IDs | — |
| Contact detail: save, tags, notes, custom fields, send template | working | `contact-detail-view.tsx` handlers + toasts | `lib/contacts/tag-write.test.ts`, API `contacts/[id]/tags/route.test.ts` |

---

## 5. Templates (Settings → Templates)

**File:** `src/components/settings/template-manager.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Sync from Meta | working | Meta sync API call (L529+) | `lib/whatsapp/template-webhook.test.ts`, validators/lifecycle tests |
| Create / edit / delete | working | `POST/PATCH/DELETE` template APIs | same |
| Category **Authentication** select option | **hide-candidate** | Listed in `CATEGORIES` (L61); submit disabled when selected (L1102); `handleSubmit` early-return (L267–269); banner warns. Creation path unsupported (`submit` route message). | submit route rejects Auth |
| Form fields (body, buttons, header media) | working | Build payload → submit | `template-validators.test.ts`, `template-send-builder.test.ts` |

---

## 6. Broadcasts

**Pages:** `broadcasts/page.tsx`, `broadcasts/new/page.tsx`, `broadcasts/[id]/page.tsx`, `components/broadcasts/*`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| New broadcast | working | `router.push('/broadcasts/new')` gated | — |
| Row → detail | working | navigate to `/broadcasts/[id]` | — |
| Wizard step1 template | working | select approved template | — |
| Step2 audience (all/tags/csv/field) | working | real queries + CSV parse | `lib/broadcast-csv.test.ts` |
| Step3 personalize | working | maps placeholders | — |
| Step4 name / save draft / send now | working | Parent creates broadcast + send pipeline (UI copy is “Review & Send”, not a fake scheduler) | `lib/whatsapp/broadcast-core.test.ts`, `broadcast-resume.test.ts`, `broadcast-status.test.ts` |
| Detail: filter, export CSV, resume pending/failed, delete | working | handlers on detail page | resume/status tests |

---

## 7. Automations / flows

### 7.1 Automations — `automations/page.tsx`, builder, new/edit/logs

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Create / template cards | working | navigate `/automations/new?template=` | `lib/automations/*.test.ts` |
| Active switch | working | `PATCH /api/automations/[id]` (L88–107) | `engine.test.ts`, `validate.test.ts` |
| Duplicate / delete / edit / logs | working | duplicate/DELETE APIs + routes | — |
| Builder save / step CRUD | working | tree mutations + save | `builder-tree.test.ts` |

### 7.2 Flows — `flows/page.tsx`, editor, runs

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| New flow / templates / edit / delete | working | `/api/flows` CRUD | `lib/flows/*.test.ts`, `flow-editor-state.test.ts` |
| Editor save / activate / canvas | working | editor shell + activate route | validate/edges/engine tests |
| Runs page | working | lists run history | — |
| Beta badge | working (label) | Soft-GA; not a gate | — |

---

## 8. Settings (all sections)

**Router:** `src/app/(dashboard)/settings/page.tsx` — `?tab=` via `resolveSection` (`settings-sections.ts`).  
**Rail:** every section button calls `onSelect` → `router.replace` (**working**).

| Section | Key controls | Class | Proof | Tests |
| --- | --- | --- | --- | --- |
| Overview | Section cards | working | `onSelect(section)` (`settings-overview.tsx`) | — |
| Profile | Avatar upload/remove, name, email, Save | working | Storage + `profiles` update + `auth.updateUser` email (`profile-form.tsx`) | — |
| Profile | Browser notifications switch + Send test | working | `Notification.requestPermission` + `writeBrowserNotifyPref`; test `new Notification` (`browser-notifications-card.tsx`) | `lib/notifications/browser-notify.test.ts` |
| Security | Change password | working | re-auth + `updateUser({ password })` (`password-form.tsx`) | — |
| Security | Sign out everywhere | working | `signOut({ scope: 'global' })` (`sessions-card.tsx`) | — |
| Appearance | Light/dark + theme cards | working | `setMode` / `setTheme` immediate + localStorage (`appearance-panel.tsx`, `hooks/use-theme.tsx`) | — |
| WhatsApp | Save / Test / Reset / Verify registration / Copy webhook / token visibility | working | `/api/whatsapp/config` GET/POST/DELETE + verify-registration (`whatsapp-config.tsx`) | webhook/config/embedded-signup tests |
| WhatsApp | Mirror inbound media switch | working | direct `whatsapp_config.mirror_inbound_media` update (L985–990) | — |
| WhatsApp | Embedded Signup button | working when shown | Only if `embeddedSignup.enabled`; POST code exchange (`embedded-signup` route). Stub mode is intentional for META_STUB. | `embedded-signup/route.test.ts`, `lib/whatsapp/embedded-signup.test.ts` |
| **Astra Connect** | Enable switch, tenant/employee/secret, clear secret, Save | working | GET/PATCH `/api/whatsapp/config/astra-connect` (`astra-connect-settings.tsx` L59–154, L212–308) | `app/api/whatsapp/config/astra-connect/route.test.ts`, `lib/astra-connect/*` |
| Templates | see §5 | — | — | — |
| Quick replies | CRUD + kind toggle | working | `/api/quick-replies` | — |
| Fields & tags | Tag CRUD | working | Supabase `tags` | — |
| Fields & tags | Custom fields (admin) | working | gated; CRUD | — |
| Deals & currency | Currency select + Save | working | `accounts.default_currency` (`deals-settings.tsx`) | `lib/currency.test.ts` |
| Team members | Invite, role change, remove, revoke invite | working | `/api/account/members`, invitations APIs (`members-tab.tsx`) | `lib/auth/invitations.test.ts`, `roles.test.ts` |
| Team members | Transfer ownership | **gap** | API `POST /api/account/transfer-ownership` + `canTransferOwnership` exist; **no UI control**. Comment in members-tab: “transfer… lands later”. | `roles.test.ts` (`canTransferOwnership`) |
| API keys | Create / copy / revoke | working | `/api/account/api-keys` | `lib/api-keys/*.test.ts` |

Note: `settings-sections.ts` comment claims `adminOnly` rail filtering; rail currently shows all sections and panels gate internally (`RequireRole` / disabled). Not dead — just inaccurate comment.

---

## 9. Adjacent product screens (in shell nav)

### 9.1 Dashboard — `dashboard/page.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Range 7/30/90 | working | `handleRangeChange` → `loadConversationsSeries` | `lib/dashboard/date-utils.test.ts` |
| Quick actions | working | Links to `/contacts`, `/pipelines`, `/broadcasts/new`, `/automations/new` (`quick-actions.tsx`). Intentionally does **not** auto-open create modals (comment L9–12). | — |
| Activity rows / page size | working | Links when `href` set; size buttons slice client data | — |
| Metric cards | n/a | Non-interactive display | — |

### 9.2 Notifications — `notifications/page.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Click notification | working | mark read + `router.push(/inbox?c=)` | — |
| Mark all read | working | bulk `read_at` update (L128–145) | — |

### 9.3 Pipelines — `pipelines/page.tsx` + components

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Board DnD, add deal, deal form save/status/delete, pipeline settings | working | Supabase deals/stages mutations | — |

### 9.4 AI Agents — `agents/page.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Tabs playground / setup / usage | working | local tab state + `/api/ai/config` | `lib/ai/*.test.ts` |
| Playground send | working | `/api/ai/playground` | — |
| Setup (AiConfig + knowledge) | working | config save/test/remove + knowledge CRUD/reindex | knowledge/config tests |
| Usage card | working | `/api/ai/usage` (admin) | `lib/ai/usage.test.ts` |

### 9.5 Legal — `legal/page.tsx`

| Control | Class | Proof | Tests |
| --- | --- | --- | --- |
| Back link | working | `<Link href="/dashboard">` | — |

---

## 10. Stub / pattern search summary

| Pattern | Product UI hits |
| --- | --- |
| `onClick={() => {}}` | **None** |
| “coming soon” / “not implemented” in UI | **None** |
| `TODO`/`FIXME` as placeholder handlers | Not found as dead click handlers |
| Feature-flagged UI | Embedded Signup card only when enabled — OK |
| Intentional stubs | `META_STUB` embedded signup (dev/test) — not a golden-rule violation when flag off |

---

## 11. Recommended golden-rule actions (priority)

1. **Ship password-reset E2E** (`/auth/callback` + `/reset-password`) or stop advertising Forgot password until fixed — currently **dead**.
2. **Hide Authentication** from template category select (keep sync/display of Meta Auth templates).
3. **Either add Transfer ownership UI** (API already exists) or leave as intentional deferral — no visible dead button today.
4. Optional polish: add `/flows` + `/agents` to header `pageTitles` (wrong title, not a dead control).

---

## 12. Test coverage map (controls → existing tests)

| Area | Test paths |
| --- | --- |
| Sidebar collapse | `src/components/layout/sidebar-state.test.ts` |
| Inbox filters | `src/lib/inbox/conversations.test.ts` |
| WhatsApp send / webhook | `src/app/api/whatsapp/send/route.test.ts`, `webhook/route.test.ts`, `lib/whatsapp/send-message.test.ts` |
| Templates | `lib/whatsapp/template-*.test.ts` |
| Broadcasts | `lib/broadcast-*.test.ts`, `lib/whatsapp/broadcast-*.test.ts` |
| Automations | `lib/automations/*.test.ts` |
| Flows | `lib/flows/*.test.ts`, `components/flows/*.test.ts` |
| Astra Connect settings API | `app/api/whatsapp/config/astra-connect/route.test.ts`, `lib/astra-connect/*.test.ts` |
| Embedded signup | `app/api/whatsapp/config/embedded-signup/route.test.ts` |
| Browser notifications prefs | `lib/notifications/browser-notify.test.ts` |
| Roles / invitations / API keys | `lib/auth/*.test.ts`, `lib/api-keys/*.test.ts` |
| AI | `lib/ai/*.test.ts` |
| Contacts tags | `lib/contacts/*.test.ts`, `app/api/contacts/[id]/tags/route.test.ts` |

**Gap:** almost no React page/component interaction tests for auth forms, settings panels, or inbox chrome — coverage is mostly API/lib.
