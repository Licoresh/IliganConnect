import type { ExpoConfig, ConfigContext } from "expo/config";
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
