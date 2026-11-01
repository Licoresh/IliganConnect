# Environment setup

The checked-out workspace has ignored local Supabase URL/publishable-key files and an applied database. Never commit `.env*` files or copy a service-role key into a client. The first migration enables PostGIS and creates all tables/RLS; later migrations extend workflows. A separate environment needs the migrations and reference seed applied before use.

Use Node.js 20.19+ and npm. From the root, run `npm ci`; its `postinstall` prepares local map assets for both clients. Copy `app/.env.example` to `app/.env` and `web/.env.example` to `web/.env.local` only when those local files do not already exist. Configure both clients for the same Supabase project. The root workspaces include `app`, `shared`, and `web`; no separate dependency installation inside either application is required.

## Authentication

For another environment, configure Supabase Auth email/password, confirmation mail and SMTP delivery. Add allowed redirect URLs for the exact administrative host, the resident browser host, and `iliganconnect://**` for the development/standalone app. Expo Go uses its current development URL; configure that URL when testing email links. Production URLs should be explicit and HTTPS. Authenticated sessions receive recovery links and display a password-change form.

Temporary development accounts have random credentials in ignored `.env.demo.json` and `.env.rbac-demo.json` files and synthetic email addresses. They are unsuitable for email-delivery testing. Use a real deliverable account to test confirmation/recovery. Admin role changes use protected RPCs; a new environment's first real admin can be promoted using the SQL in README. Account and office placeholders are not proof of institutional approval.

The Supabase advisor reports leaked-password protection disabled. Review and enable it in Auth settings when supported by the project's plan. It was not enabled or represented as tested here.

## Web

From the workspace root, `npm run dev:web` serves Next.js on port 3000. `npm run build` creates the production build; `npm run start -w web` serves it. Configure both NEXT_PUBLIC_SUPABASE variables before building.

For hosted deployment, preserve the workspace layout and shared package. Run the root install/asset preparation before building `web/`. Supabase remains the backend; Next.js does not need a service-role secret.

## Resident mobile

`npm run dev:app` starts Expo. Use an SDK 54-compatible Expo Go client or development build. `npm run preview:app` runs the same resident application in a browser; native maps use react-native-maps and the browser adapter uses MapLibre. Native session storage uses SecureStore; browser sessions use the browser's local storage.

`npm run export:app` bundles Android/iOS JavaScript and the browser preview. This does not create an APK. Standalone Android requires a restricted `GOOGLE_MAPS_ANDROID_API_KEY`; `app/app.config.ts` reads it. An Expo/EAS account and project link are needed to run the supplied APK preview profile. iOS distribution needs Apple signing credentials; local iOS simulation requires macOS. Physical devices must reach Metro over the local network.

### Free location and barangay checks

The report form calls the authenticated `resolve_report_location` Supabase RPC. It checks imported barangay polygons and the OpenStreetMap Iligan city boundary with PostGIS. No Google geocoding key, paid geocoding service or external request per pin is needed. Apply the boundary migrations before using this flow in another environment. See `data/README.md` for provenance and limitations.

The `reverse-geocode` Edge Function proxies the same RPC for older app clients. Deploy it with:

```sh
supabase functions deploy reverse-geocode --project-ref kbihklfbqhmtowcqojir
```

Both endpoints require a signed-in, active account. A single matching barangay is suggested; missing or overlapping barangay coverage requires manual selection. Residents can correct the suggestion and confirm a mismatch. City coverage includes either source to avoid rejecting outer areas missing from the older barangay snapshot. Pins near the city boundary return an uncertain result instead of a definitive outside claim. These datasets are indicative, not a legal boundary survey. Run `npm run test:location` with the configured temporary development account to check representative locations, invalid input and authentication.

Google and Facebook login buttons appear only when the respective Supabase provider is enabled. Provider credentials and redirect allowlists remain account configuration; email confirmation and recovery delivery require a real deliverable test account. No billing or paid provider was enabled.

## Maps, files and notifications

MapLibre v6 needs its worker and shared module. `scripts/prepare-map-assets.mjs` copies the installed package assets to each app's public folder during install. The browser adapter also enables Expo's import-meta transform; after changing Babel configuration, export with `--clear`.

Keep `report-evidence`, `announcement-media` and `profile-media` buckets private. All three limit uploads to 5 MB JPEG/PNG/WebP files. Profile photos use an owner-specific folder; report and announcement attachments retain their existing ownership rules. Signed URLs are generated only after RLS authorizes the record. Public report RPCs return limited summaries and rounded coordinates. Do not add anonymous report-read policies.

In-app notifications need no platform credentials. Migration `20261024045513_scheduled_announcement_delivery` enables pg_cron and schedules `iligan-announcement-publication` every minute. The private worker delivers eligible published announcements once; already-published history is marked delivered at installation to avoid replay. Monitor `cron.job_run_details` and define log retention for operational use. Remote push, production tile capacity, backups and institutional retention remain deployment configuration.

## Checks and live data

`npm run typecheck` checks the resident and staff applications; `npm test` runs all local unit tests with the pinned `tsx` runner. `npm run test:live`, `npm run test:location`, and `npm run test:navigation` read connected data using ignored local accounts. `npm run test:storage` creates uniquely named temporary uploads and verifies their removal; it does not attach them to reports or update profiles. These checks require the existing local environment and credential files.

Do not run the older fixture-writing acceptance/preparation scripts on the operational project. They are guarded for isolated test environments. The reference seed supplies geography/categories, not resident incidents or government activity.

The owner explicitly requested a populated presentation workspace in the connected project. Follow [workspace setup and removal](sample-workspace.md) for its separate guarded scripts. Its 36 fictional cases and community records retain internal origin flags, while the screens use natural copy without repeated sample/demo labels. Website photo attribution remains visible and metadata stays in private Storage. The coordinates lie within the stored indicative barangay polygons; neither coordinates nor photos establish a real incident. Prepared records appear in database-driven counts/maps/charts only while **Include presentation records** (`analytics_settings.include_samples`) is enabled through Administration → Configuration. Disabling it hides their roots, linked notifications, evidence metadata and new file access while preserving actual records. Existing signed URLs keep their normal short expiry.
