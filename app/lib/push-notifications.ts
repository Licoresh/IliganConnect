import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { db, result } from "./client";

export type PushSetupResult = "registered" | "permission-required" | "not-configured" | "unsupported";

export function expoProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    ?? "";
}

const devicePushPreferenceKey = (userId: string) => `phone-alerts.${userId}`;
const devicePushTokenKey = (userId: string) => `phone-alerts-token.${userId}`;
const alertCursorKey = (userId: string) => `phone-alert-cursor.${userId}`;

export async function getDevicePushPreference(userId: string): Promise<boolean | null> {
  const value = await SecureStore.getItemAsync(devicePushPreferenceKey(userId));
  return value === null ? null : value === "on";
}

export async function setDevicePushPreference(userId: string, enabled: boolean) {
  await SecureStore.setItemAsync(devicePushPreferenceKey(userId), enabled ? "on" : "off");
}

export async function hasRegisteredDevicePushToken(userId: string) {
  return !!(await SecureStore.getItemAsync(devicePushTokenKey(userId)));
}

export async function pollResidentAlerts() {
  if (!db || Platform.OS === "web") return false;
  let { data: session } = await db.auth.getSession();
  if (session.session?.expires_at && session.session.expires_at <= Math.floor(Date.now() / 1000) + 90) {
    const refreshed = await db.auth.refreshSession();
    session = refreshed.data;
  }
  const userId = session.session?.user.id;
  if (!userId) return false;
  const [profile, permission, preference] = await Promise.all([
    db.from("profiles").select("role, account_status, notifications_enabled").eq("id", userId).maybeSingle(),
    Notifications.getPermissionsAsync(),
    getDevicePushPreference(userId),
  ]);
  if (profile.error || profile.data?.role !== "resident" || profile.data?.account_status !== "active" || !profile.data.notifications_enabled || !permission.granted || preference === false) return false;

  const { data, error } = await db.from("notifications").select("id, title, created_at").eq("user_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(30);
  if (error) return false;
  if (!data?.length) return true;
  const cursorKey = alertCursorKey(userId);
  const cursor = await SecureStore.getItemAsync(cursorKey);
  if (!cursor) {
    await SecureStore.setItemAsync(cursorKey, data[0].id);
    return true;
  }
  const cursorIndex = data.findIndex(item => item.id === cursor);
  if (cursorIndex < 0) {
    await SecureStore.setItemAsync(cursorKey, data[0].id);
    return true;
  }
  for (const item of data.slice(0, cursorIndex).reverse().slice(-5)) {
    await Notifications.scheduleNotificationAsync({
      content: { title: item.title, body: "Open Iligan Connect to view this update.", sound: "default" },
      trigger: { channelId: "community-alerts" },
    });
  }
  await SecureStore.setItemAsync(cursorKey, data[0].id);
  return true;
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
  const previousToken = await SecureStore.getItemAsync(devicePushTokenKey(userId));
  await result(db.from("device_push_tokens").upsert({
    user_id: userId,
    expo_push_token: token,
    platform: Platform.OS,
    updated_at: new Date().toISOString(),
  }, { onConflict: "expo_push_token" }));
  await SecureStore.setItemAsync(devicePushTokenKey(userId), token);
  if (previousToken && previousToken !== token) {
    await db.from("device_push_tokens").delete().eq("user_id", userId).eq("expo_push_token", previousToken);
  }
  return "registered";
}

export async function removeDevicePushTokens(userId: string) {
  if (!db || Platform.OS === "web") return;
  const token = await SecureStore.getItemAsync(devicePushTokenKey(userId));
  if (!token) return;
  await result(db.from("device_push_tokens").delete().eq("user_id", userId).eq("expo_push_token", token));
  await SecureStore.deleteItemAsync(devicePushTokenKey(userId));
}
