# Android app updates and notifications

## App updates

The resident app checks GitHub Releases when it opens and when it returns to the foreground, at most once every six hours. A newer stable APK is offered in the app; Android still asks the resident to confirm installation.

For each release:

1. Increase `expo.version` and `android.versionCode` in `app/app.json`.
2. Build and sign the APK with the same signing key used by the installed sideload build.
3. Publish `Iligan-Connect-Resident.apk` as a GitHub Release asset at `v<version>`.
4. Publish `android-update.json` in that same release with this shape:

   ```json
   {
     "version": "1.0.7",
     "downloadUrl": "https://github.com/Licoresh/IliganConnect/releases/download/v1.0.7/Iligan-Connect-Resident.apk"
   }
   ```

The APK checks `https://github.com/Licoresh/IliganConnect/releases/latest/download/android-update.json`. Keep the version and release URL in the manifest aligned. The current sideload APK is debug-key signed; keep that signing key safe for compatible installs. A production signing-key change requires residents to install the new app separately.

## Phone push notifications

The app requests Android notification permission and sends alerts only when the signed-in resident’s in-app notification preference is on. With Firebase and Expo configured, Supabase sends a high-priority Expo push to the resident’s registered device token.

Before push works in a standalone APK:

1. Sign in to an Expo account and initialize/link this app with `eas init`; set its project UUID as `EXPO_PUBLIC_EAS_PROJECT_ID` for the APK build.
2. Create the Firebase Android app for package `org.iligan.community`, download its `google-services.json`, and set `GOOGLE_SERVICES_JSON` to that file's path when building. `app/app.config.ts` passes it to `expo.android.googleServicesFile`.
3. Upload the Firebase Cloud Messaging V1 service-account key in Expo/EAS Android credentials. Keep the service-account JSON private and out of Git.
4. Build and install a new APK, allow Android notifications, and send a test push to a registered device before publishing the release manifest.

The Expo project ID and Firebase credentials are not present in this workspace. Until they are configured, the app uses local phone notifications: it checks for updates every 30 seconds while open and schedules an Android background check with WorkManager when the app is not active. Android allows a minimum 15-minute interval, and the system can defer the work based on battery and network conditions. Force-stopping the app prevents background checks until it is opened again. The Profile switch turns on only after Android notification permission is granted; its message says that delivery may be delayed. Once an Expo project ID is bundled, local polling stops and the switch turns on only after a remote push token is registered.

The `resident-phone-alerts` task is defined at module scope and registered only for an active resident with phone permission and notifications enabled. It polls the resident’s RLS-protected notification rows and stores a per-account cursor in secure storage, then schedules at most five new local banners per run. Supabase’s token table and push trigger are already configured; no device token was registered as of 2026-11-15.

## Meeting schedule windows

Staff choose the meeting date, start time, and end time in Philippine time. The database stores both instants in `meetings.starts_at` and `meetings.ends_at`, requires a positive window of at most 12 hours, and backfilled existing schedules to one hour. Resident meeting cards and meeting emails show the full time range. Calendar drafts use the same start and end values.
