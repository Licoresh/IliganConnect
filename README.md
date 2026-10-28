# Iligan Connect — Resident App

React Native and Expo application for Iligan Connect residents.

## Iteration 1: Expo setup and resident authentication

The Expo SDK 54 app supports Android, iOS, and web. Resident sign-in and account flows use Supabase Auth.

## Iteration 2: Report categories

The reporting interface presents the six configured report categories and uses the selected category to start a report.

## Run locally

Requires Node.js 20.19+ and npm.

```powershell
npm install
Copy-Item app/.env.example app/.env
npm run start
```

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `app/.env` before signing in. Keep credentials out of Git.