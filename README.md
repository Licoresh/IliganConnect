# Iligan Connect

The Expo resident application (`app/`) and Next.js staff workspace (`web/`) share Supabase authentication, reports, community activity, private storage, and the domain package in `shared/`. Staff access is enforced by database roles and office/barangay scope.

## Run locally

Requires Node.js 20.19+ and npm.

```powershell
npm ci
if (!(Test-Path app/.env)) { Copy-Item app/.env.example app/.env }
if (!(Test-Path web/.env.local)) { Copy-Item web/.env.example web/.env.local }
npm run start
```

Set `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `app/.env` and `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `web/.env.local` to the same project. Use a publishable/anonymous client key; keep privileged keys out of both clients. Copy example files only when the local configuration does not already exist.

| Command | Purpose |
| --- | --- |
| `npm start` / `npm run dev:app` | Resident app in Expo; Android/iOS use Expo Go or a development build |
| `npm run preview:app` | Resident browser preview |
| `npm run dev:web` | Staff workspace on port 3000 |
| `npm run typecheck` | Check both applications |
| `npm test` | Run local unit tests; no Supabase mutations |
| `npm run build` | Build the staff workspace |
| `npm run start -w web` | Serve the built staff workspace |
| `npm run export` / `npm run export:app` | Export resident web, Android, and iOS JavaScript bundles |
| `npm run test:live` | Read-only connected role, permission, and workflow-data checks |
| `npm run test:location` | Read-only location/authentication checks |
| `npm run test:navigation` | Read-only linked-record and report-query checks |
| `npm run test:storage` | Temporary upload/privacy probes with cleanup; no report/profile changes |
| `npm run test:samples` | Read-only verification of the explicitly loaded sample workspace and photos |

`npm ci` prepares both clients' local MapLibre workers through `postinstall`. Live checks use ignored local credential files and require the connected project's existing accounts; a fresh clone does not contain those credentials. Fixture-writing scripts are guarded and must only target an isolated test project.

Reports, analytics, maps, and community screens use saved records and honest empty states. No sample incidents are loaded automatically. At the owner's request, this connected environment includes a [prepared presentation workspace](docs/sample-workspace.md): 36 fictional cases with distinct mapped positions, pending/completed workflows, community records and private [licensed website photos](docs/sample-images.md). Screens use natural copy without repeated sample/demo labels; origin flags remain in the database and photo credits remain visible. These images do not document actual Iligan incidents. Administration → Configuration → Include presentation records controls visibility. The preparation, loading, verification and guarded removal steps are documented together.

For a new Supabase environment, apply the migrations and reference seed before starting the clients. Register and confirm the owner's account, then bootstrap its staff role once in the Supabase SQL editor:

```sql
update public.profiles
set role = 'admin', account_status = 'active'
where id = (select id from auth.users where email = 'OWNER_EMAIL');
```

Replace `OWNER_EMAIL` with the confirmed account's address. Later staff invitations, approvals, memberships, and responsibilities are managed in Administration. See [environment setup](docs/setup.md), [RBAC](docs/rbac.md), and [verification](docs/verification.md) for deployment requirements and the scope of executed checks.
