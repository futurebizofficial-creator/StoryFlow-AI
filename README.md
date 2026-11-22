# StoryFlow AI — Milestone 1

A Next.js 16 (App Router) + Supabase SaaS foundation: authentication, multi-tenant workspaces with
Owner/Admin/Member roles, invitations, projects, Script Studio and integration settings.

## Stack

- Next.js 16.4 (App Router, Turbopack, `src/proxy.ts` for session refresh + route protection)
- React 19, TypeScript, Tailwind CSS v4 (light/dark/system theme)
- Supabase Auth + Postgres with Row Level Security (`@supabase/ssr`, cookie sessions)

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in the Supabase values
npm run dev                     # http://localhost:3000
```

Without Supabase credentials the app still runs; auth and app pages show a "Connect Supabase" screen
and `/api/health` reports `degraded`.

## Supabase setup

1. **Create a project** at supabase.com and copy *Project URL* and the *anon / publishable key*
   (Project Settings → API) into `.env.local`.
2. **Apply the migration** in `supabase/migrations/`:
   - CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`, or
   - Dashboard: paste the SQL file into the SQL Editor and run it.
3. **Auth → URL Configuration**
   - Site URL: your deployed URL (e.g. `https://storyflow-ai.onrender.com`)
   - Redirect URLs: `http://localhost:3000/**` and `https://<your-domain>/**`
4. **Auth → Email Templates** (recommended — makes links work on any device/browser):
   - *Confirm signup*: link to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`
   - *Reset password*: link to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`

   The default templates also work (PKCE `code` flow) when the link is opened in the same browser.
5. For production email volume configure custom SMTP (Auth → SMTP). Supabase's built-in sender is
   rate-limited.

The web app uses no service-role key. All of its database access runs as the signed-in user and is
enforced by RLS. Only the separate video worker uses `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`
and `docs/VIDEO_PLATFORM.md`); set it in the worker's environment only.

## Security model

| Table | Read | Write |
| --- | --- | --- |
| `workspaces` | members | rename: owner/admin · delete: owner · create: `create_workspace()` |
| `workspace_members` | members | only via `update_member_role()` / `remove_member()` / `accept_invitation()` |
| `workspace_invitations` | owner/admin, or the invitee's own email | owner invites admin/member, admin invites member; revoke only |
| `projects`, `scripts` | members | members create/edit; delete: owner/admin or creator |
| `workspace_integrations` | members | owner/admin |
| `profiles` | self + teammates | self (`full_name`, `avatar_url` only) |

Role hierarchy and invariants (at least one owner, admins cannot touch owners, no self role change,
scripts can only link to projects in the same workspace, `workspace_id` is immutable) are enforced in
the database, not just the UI. Anonymous users have no table or function access.

Invitations are link-based: an admin creates one on **Team**, copies the link, and shares it. The
invitee also sees pending invitations on sign-in. Automated invitation emails are not configured.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server (`PORT` respected) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests (Node test runner) |
| `npm run test:db` | Applies the migration to an in-memory Postgres (PGlite) and verifies 46 RLS/permission rules |

## Deploying to Render

`render.yaml` is a Blueprint: **New → Blueprint** → select the repo. It defines two services, and
Render prompts for every `sync: false` value when the Blueprint is created:

- **`storyflow-ai`** (web): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_SITE_URL` (your Render URL; `RENDER_EXTERNAL_URL` is used if unset), and
  `STORYFLOW_CREDENTIALS_KEY`. Optional: `AUTOMATED_VIDEO_GENERATOR_URL` and `VIDEO_ENGINE_TOKEN`
  (same values as the worker; HTTPS required) to show the engine's voice list in AI Video Studio.
  They are read server-side only. Health check: `GET /api/health`.
- **`storyflow-video-worker`** (background worker, `npm run worker`): `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `STORYFLOW_CREDENTIALS_KEY`, `AUTOMATED_VIDEO_GENERATOR_URL`,
  `AGENTIC_VIDEO_URL`, and `VIDEO_ENGINE_TOKEN`.

Use the **same** `STORYFLOW_CREDENTIALS_KEY` on both services. `SUPABASE_SERVICE_ROLE_KEY` goes on the
worker only. Env vars are read at request time, so changing them only needs a restart.

## Integrations

The Integrations page stores per-workspace, non-secret preferences (enabled flag, default model,
voice ID, webhook URL). Provider keys belong in server env vars (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `YOUTUBE_CLIENT_ID`/`SECRET`); the UI only reports whether a
variable exists and never claims a connection. No provider API calls are made in Milestone 1.
