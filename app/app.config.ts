import type { ExpoConfig, ConfigContext } from "expo/config";

// v1.1.9 shipped without these and showed "The app is not connected yet". Release bundles must fail instead.
// Local builds read app/.env; EAS cloud builds skip git-ignored .env files, so set them as EAS environment variables.
const missingSupabase = ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY"].filter((name) => !process.env[name]);
if (missingSupabase.length && (process.env.EAS_BUILD === "true" || process.env.NODE_ENV === "production")) {
  throw new Error(`Missing ${missingSupabase.join(" and ")} for this release build. Add them to app/.env (local) or as EAS environment variables.`);
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Iligan Connect",
  slug: "iligan-connect",
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
    config: {
      ...config.android?.config,
      ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY
        ? { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } }
        : {}),
    },
  },
});
