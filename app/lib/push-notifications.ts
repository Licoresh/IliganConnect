import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { db, result } from "./client";

export type PushSetupResult = "registered" | "permission-required" | "not-configured" | "unsupported";

export function expoProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    ?? "";
}

export async function registerDevicePushToken(userId: string): Promise<PushSetupResult> {
  if (!db || Platform.OS === "web") return "unsupported";
  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) return "permission-required";

  const projectId = expoProjectId();
  if (!projectId) return "not-configured";

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("community-alerts", {
      name: "Community alerts",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await result(db.from("device_push_tokens").upsert({
    user_id: userId,
    expo_push_token: token,
    platform: Platform.OS,
    updated_at: new Date().toISOString(),
  }, { onConflict: "expo_push_token" }));
  return "registered";
}

export async function removeDevicePushTokens(userId: string) {
  if (!db || Platform.OS === "web") return;
  await result(db.from("device_push_tokens").delete().eq("user_id", userId));
}
