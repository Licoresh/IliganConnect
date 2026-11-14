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
     "version": "1.0.2",
     "downloadUrl": "https://github.com/Licoresh/IliganConnect/releases/download/v1.0.2/Iligan-Connect-Resident.apk"
   }
   ```

The APK checks `https://github.com/Licoresh/IliganConnect/releases/latest/download/android-update.json`. Keep the version and release URL in the manifest aligned. The current sideload APK is debug-key signed; keep that signing key safe for compatible installs. A production signing-key change requires residents to install the new app separately.

## Phone push notifications

The app requests Android notification permission, registers the signed-in resident’s Expo push token, and stores it in `public.device_push_tokens`. Supabase sends a high-priority Expo push when it creates a resident notification. Push is sent only while the resident’s in-app notification preference is on. Android phone permission and the app preference must both be enabled.

Before push works in a standalone APK:

1. Sign in to an Expo account and initialize/link this app with `eas init`; set its project UUID as `EXPO_PUBLIC_EAS_PROJECT_ID` for the APK build.
2. Create the Firebase Android app for package `org.iligan.community`, download its `google-services.json`, and set `expo.android.googleServicesFile` in the Expo config.
3. Upload the Firebase Cloud Messaging V1 service-account key in Expo/EAS Android credentials. Keep the service-account JSON private and out of Git.
4. Build and install a new APK, allow Android notifications, and send a test push to a registered device before publishing the release manifest.

The project ID and Firebase credentials are not present in this workspace. Until they are configured, Profile shows that push delivery is pending; in-app notifications continue to work.
