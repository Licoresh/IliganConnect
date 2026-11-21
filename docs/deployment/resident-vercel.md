# Resident website deployment

## Deployment layout

Create a second Vercel project for the resident website from this same repository. It can live under a different Vercel account as long as that account can access the Git repository. Keep the current Vercel project for the staff Next.js workspace.

The resident project builds the Expo web app from `app`; its static output is a single-page app. The staff project builds `web`. Their deployments, domains, environment settings, and rollbacks are separate.

Both sites use the same Supabase project so reports and updates stay in one system. Separate Vercel projects do not isolate the Supabase API. The resident app refuses staff accounts, staff access is handled by the staff workspace, and Supabase row-level security and RPC authorization are the actual data/action boundary. Never put a Supabase service-role/secret key in either browser project.

## Steps to deploy

1. **Push the intended code to GitHub.** Vercel deploys Git commits, not uncommitted workspace files. This repository is an npm monorepo; a push may start deployments for both connected Vercel projects. Vercel can skip unaffected workspace projects when that setting is enabled.

2. **Import the repository in the resident Vercel account.** In Vercel, choose **Add New → Project**, authorize the Git provider if asked, and import the existing Iligan Connect repository. If it is private and does not appear, grant the new Vercel account's Git integration access to that repository.

3. **Set the resident project root.** Use these settings:

   | Setting | Value |
   | --- | --- |
   | Root Directory | `app` |
   | Include source files outside Root Directory | Enabled; the app uses the shared workspace at `../shared` |
   | Framework Preset | Other |
   | Install Command | `cd .. && npm install --include=optional` |
   | Build Command | `cd .. && npm run export:web:resident` |
   | Output Directory | `dist` |

   The commands and SPA rewrite are already in [app/vercel.json](../../app/vercel.json). If Vercel asks for build settings during import, use these same values. Expo's `web.output: "single"` emits `index.html`; the rewrite sends browser routes back to that entry.

4. **Add the resident Supabase environment variables** in **Project Settings → Environment Variables**. Use [resident-vercel.env.example](resident-vercel.env.example) for the names:

   - `EXPO_PUBLIC_SUPABASE_URL` — the same Supabase project URL as the current system.
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` — that project's publishable key or legacy anon key.

   Add them to Production and Preview if both environments should connect. These `EXPO_PUBLIC_*` values are embedded into the browser bundle; only use a publishable/anon key. Never add `SUPABASE_SERVICE_ROLE_KEY` or an `sb_secret_*` key. `EXPO_PUBLIC_EAS_PROJECT_ID` is not needed for the resident website; browser push is not implemented here.

5. **Deploy and add a domain.** Deploy the production branch (currently `main`). Start with the Vercel-provided `.vercel.app` URL. A custom resident domain or subdomain is optional; add it under the resident Vercel project's **Settings → Domains**.

6. **Allow the resident Auth callback in Supabase.** This app sends its current web origin as the Auth redirect target. In Supabase **Authentication → URL Configuration**, add the resident production URL to **Redirect URLs** and keep the existing staff URL there. Do not replace the current **Site URL** just to add the resident site; both apps share one Supabase Auth project, and Site URL is the fallback when code supplies no redirect target. Add a narrow Preview URL pattern only if you will test email callbacks from Vercel Preview deployments. Add the custom domain too if you use one.

7. **Verify the deployment.** Open the resident URL, sign in with a resident account, confirm Home/Explore/Community load, and refresh a nested route. Confirm a staff account is refused by the resident site, then sign into the staff site and confirm its workspace still loads. Use existing records for this check; avoid creating a public test report in production.

Vercel's [monorepo setup](https://vercel.com/docs/monorepos/monorepo-faq) documents separate projects and the outside-root source option. See [Vercel environment variables](https://vercel.com/docs/environment-variables) and [Expo web publishing](https://docs.expo.dev/guides/publishing-websites/) for the related platform behavior. Supabase's [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls) explains the Site URL and allowlist.

## Prepared files

- [app/vercel.json](../../app/vercel.json) — resident-only export command, output directory, and SPA rewrite.
- [resident-vercel.env.example](resident-vercel.env.example) — safe variable-name checklist with placeholders.
- Root script `npm run export:web:resident` — web-only Expo export; Android/iOS builds stay separate.

No Vercel project or domain has been created from this workspace.
